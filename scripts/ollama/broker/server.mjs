import { BROKER_HEADER, BROKER_VERSION } from '../../../apps/api/src/ai/ollamaBrokerProtocol.js';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { clientIdentity, clientPolicies, showRequest, validateGeneration } from './policy.mjs';

const MAX_BODY = 6 * 1024 * 1024;
const MAX_METADATA = 512 * 1024;
const MAX_GENERATION = 128 * 1024;
const MINUTE = 60_000;
const failure = (status, code) => Object.assign(new Error(code), { status, code });

async function readRequest(req, limit) {
  if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type'] ?? '')) throw failure(415, 'invalid_input');
  if (Number(req.headers['content-length']) > limit) throw failure(413, 'invalid_input');
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) throw failure(413, 'invalid_input');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw failure(400, 'invalid_input'); }
}

async function readResponse(response, limit, onChunk) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Upstream size limit');
    if (onChunk) onChunk(chunk);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function reply(res, status, payload) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', Connection: 'close', ...(status === 429 ? { 'Retry-After': '5' } : {}) });
  res.end(JSON.stringify(payload));
}

export function createInferenceBroker({
  clients, upstream = 'http://127.0.0.1:11434', waitMs = 15_000, totalMs = 65_000,
  unloadMs = 8_000, pollMs = 100, log = () => {},
}) {
  const policies = clientPolicies.parse(clients);
  if (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(upstream) || !Number(new URL(upstream).port)) throw new Error('Invalid private Ollama address');
  if (![waitMs, totalMs, unloadMs, pollMs].every(value => Number.isSafeInteger(value) && value > 0) || waitMs >= totalMs) throw new Error('Invalid broker deadlines');
  const ids = Object.keys(policies);
  const state = Object.fromEntries(ids.map(id => [id, { waiting: [], arrivals: [], open: 0 }]));
  let active = false, last = ids.at(-1), recoveryRequired = false;

  const call = (path, body, signal) => fetch(upstream + path, {
    redirect: 'error', signal, ...(body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  });
  async function metadata(path, body, signal = AbortSignal.timeout(1500)) {
    const response = await call(path, body, signal);
    if (!response.ok) { await response.body?.cancel(); throw failure(503, 'ollama_offline'); }
    return JSON.parse(await readResponse(response, MAX_METADATA));
  }
  async function running(signal) {
    const result = await metadata('/api/ps', undefined, signal);
    if (!Array.isArray(result.models)) throw new Error('Invalid Ollama runner status');
    return result.models;
  }
  async function waitForUnload() {
    const signal = AbortSignal.timeout(unloadMs);
    while ((await running(signal)).length) await sleep(pollMs, undefined, { signal });
  }

  async function run(job) {
    const { res, payload, path, id, deadline } = job;
    const start = performance.now();
    let dispatched = false;
    let code = 'ok';
    const signal = AbortSignal.timeout(Math.max(1, Math.ceil(deadline - start)));
    try {
      if ((await running(signal)).length) throw failure(503, 'recovery_required');
      if (res.destroyed || res.writableEnded) return;
      signal.throwIfAborted();
      dispatched = true;
      const response = await call(path, payload, signal);
      if (!response.ok) {
        await readResponse(response, MAX_GENERATION);
        await waitForUnload();
        dispatched = false;
        throw failure(response.status === 429 ? 429 : 503, 'provider_unavailable');
      }
      const streaming = payload.stream;
      if (streaming && !res.destroyed) {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      }
      const body = await readResponse(response, MAX_GENERATION,
        streaming ? chunk => { if (!res.destroyed && !res.writableEnded) res.write(chunk); } : undefined);
      const done = JSON.parse(streaming ? body.trimEnd().split('\n').at(-1) : body);
      if (done.model !== payload.model || done.done !== true) throw new Error('No terminal Ollama response');
      await waitForUnload();
      if (!res.destroyed && !res.writableEnded) {
        if (streaming) res.end();
        else reply(res, 200, done);
      }
    } catch (error) {
      // A broken upstream connection is not proof that the GPU stopped.
      if (dispatched) recoveryRequired = true;
      code = signal.aborted ? 'timeout' : error.status ? error.code : 'ollama_offline';
      reply(res, signal.aborted ? 504 : error.status ?? 503, { code });
    } finally {
      log({ project: id, model: payload.model, code, cancelled: res.destroyed && !res.writableFinished, durationMs: Math.round(performance.now() - start), recoveryRequired });
    }
  }

  function pump() {
    if (active) return;
    if (recoveryRequired) {
      for (const id of ids) while (state[id].waiting.length) state[id].waiting.shift().reject(failure(503, 'recovery_required'));
      return;
    }
    // Rotate projects at every dispatch and preserve arrival order within each project.
    const id = [ids[(ids.indexOf(last) + 1) % ids.length], last].find(key => state[key].waiting.length);
    if (!id) return;
    const job = state[id].waiting.shift();
    last = id;
    active = true;
    job.cleanup();
    run(job).then(job.resolve, job.reject).finally(() => { active = false; pump(); });
  }

  function enqueue(job) {
    return new Promise((resolve, reject) => {
      const waiting = state[job.id].waiting;
      const remove = error => {
        const index = waiting.indexOf(job);
        if (index < 0) return;
        waiting.splice(index, 1);
        job.reject(error);
      };
      const close = () => remove(failure(499, 'cancelled'));
      const timer = setTimeout(() => remove(failure(429, 'queue_timeout')), waitMs);
      job.cleanup = () => { clearTimeout(timer); job.res.off('close', close); };
      job.reject = error => { job.cleanup(); reject(error); };
      job.resolve = resolve;
      job.res.once('close', close);
      waiting.push(job);
      pump();
    });
  }

  return createServer({ requestTimeout: 10_000, headersTimeout: 5_000, connectionsCheckingInterval: 1000 }, async (req, res) => {
    res.setHeader(BROKER_HEADER, BROKER_VERSION);
    const started = performance.now();
    if (req.headers.origin) return reply(res, 403, { code: 'forbidden' });
    const id = clientIdentity(req.headers.authorization, policies);
    if (!id) return reply(res, 401, { code: 'unauthorized' });
    const policy = policies[id];
    const project = state[id];
    const path = req.url;
    const generation = req.method === 'POST' && (path === '/api/chat' || (id === 'adrift' && path === '/api/generate'));
    const getMetadata = req.method === 'GET' && (path === '/api/version' || path === '/api/tags' || (id === 'adrift' && path === '/api/ps'));
    const show = req.method === 'POST' && path === '/api/show';
    if (!generation && !getMetadata && !show) return reply(res, 404, { code: 'not_found' });
    if (recoveryRequired) return reply(res, 503, { code: 'recovery_required' });
    if (project.open >= policy.pending) return reply(res, 429, { code: 'queue_full' });
    project.open++;
    try {
      const models = [...policy.text, ...policy.vision];
      if (generation) {
        const now = performance.now();
        while (project.arrivals[0] <= now - MINUTE) project.arrivals.shift();
        if (project.arrivals.length >= policy.rpm) throw failure(429, 'rate_limited');
        project.arrivals.push(now);
        const raw = await readRequest(req, id === 'adrift' ? 48 * 1024 : MAX_BODY);
        const { data, error } = validateGeneration(raw, policy, path === '/api/chat');
        if (error) throw failure(error === 'model_not_allowed' ? 403 : 400, error);
        const deadline = started + totalMs;
        if (deadline <= performance.now()) throw failure(504, 'timeout');
        const timer = setTimeout(() => reply(res, 504, { code: 'timeout' }), Math.ceil(deadline - performance.now()));
        try { if (!res.destroyed) await enqueue({ id, res, payload: data, path, deadline }); }
        finally { clearTimeout(timer); }
      } else {
        const parsed = show ? showRequest.safeParse(await readRequest(req, 1024)) : null;
        if (parsed && !parsed.success) throw failure(400, 'invalid_input');
        if (parsed && !models.includes(parsed.data.model)) throw failure(403, 'model_not_allowed');
        const data = await metadata(path, parsed?.data);
        if (path === '/api/tags' || path === '/api/ps') {
          if (!Array.isArray(data.models)) throw failure(503, 'ollama_offline');
          data.models = data.models.filter(entry => models.includes(entry.name ?? entry.model));
        }
        reply(res, 200, data);
      }
    } catch (error) {
      reply(res, error.status ?? 503, { code: error.status ? error.code : 'ollama_offline' });
    } finally { project.open--; }
  });
}
