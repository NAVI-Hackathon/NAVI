import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { createInferenceBroker } from './server.mjs';
import { adriftBrokerFetch } from './adrift-transport.mjs';
import { createOllamaTransport } from '../../../apps/api/src/ai/ollamaTransport.js';

const text = 'qwen3:4b-instruct-2507-q4_K_M';
const vision = 'qwen3.5:4b-q4_K_M';
const png = readFileSync(new URL('../../../apps/api/eval/holdout/v2/fixtures/bank.png', import.meta.url));
const clients = {
  adrift: { token: 'a'.repeat(43), text: [vision], vision: [], rpm: 30, pending: 3 },
  navi: { token: 'b'.repeat(43), text: [text], vision: [vision], rpm: 30, pending: 3 },
};
const chat = (model, content, images) => ({ model, stream: false, messages: [{ role: 'user', content, ...(images ? { images } : {}) }] });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function listening(t, server) {
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + server.address().port;
}

async function fixture(t, options = {}) {
  let resident = [];
  const records = [], events = [];
  let active = 0, peak = 0;
  const upstream = await listening(t, createServer(async (req, res) => {
    if (req.url === '/api/version') return res.end(JSON.stringify({ version: 'test' }));
    if (req.url === '/api/ps') return res.end(JSON.stringify({ models: resident }));
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: text }, { name: vision }] }));
    if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: ['completion', 'vision'] }));
    const parts = [];
    for await (const part of req) parts.push(part);
    const input = JSON.parse(Buffer.concat(parts).toString());
    records.push(input.messages?.at(-1)?.content ?? input.prompt);
    active++;
    peak = Math.max(peak, active);
    resident = [{ name: input.model, size_vram: 1000 }];
    try {
      const terminal = { model: input.model, done: true, done_reason: 'stop', response: 'ok',
        message: { role: 'assistant', content: 'ok' }, prompt_eval_count: 2, eval_count: 1 };
      await options.handle?.(input, res);
      if (res.destroyed || res.writableEnded) return;
      assert.equal(input.keep_alive, 0);
      res.end(JSON.stringify(terminal) + (input.stream ? '\n' : ''));
    } finally {
      active--;
      if (!options.sticky) setTimeout(() => { resident = []; }, options.unloadDelay ?? 0).unref();
    }
  }));
  const url = await listening(t, createInferenceBroker({
    clients, upstream, waitMs: 500, totalMs: 2500, unloadMs: 300, pollMs: 5,
    ...options, log: entry => events.push(entry),
  }));
  function send(project, path, body, signal) {
    return fetch(url + path, { signal, headers: { ...(project ? { Authorization: 'Bearer ' + clients[project].token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  }
  return { url, records, events, send, peak: () => peak };
}
async function until(check) {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await sleep(10);
  }
  assert.fail('Event did not arrive');
}

test('identity, exact model and image envelope validation reject invalid traffic before Ollama', async t => {
  const f = await fixture(t);
  assert.equal((await f.send(null, '/api/version')).status, 401);
  assert.equal((await f.send('navi', '/api/pull', { model: text })).status, 404);
  assert.equal((await f.send('navi', '/api/generate', { model: text, prompt: 'synthetic' })).status, 404);
  assert.equal((await f.send('adrift', '/api/show', { model: text })).status, 403);
  assert.equal((await f.send('adrift', '/api/chat', chat(vision, 'synthetic', [png.toString('base64')]))).status, 403);
  const pixels = Buffer.from(png); pixels.writeUInt32BE(2_000_001, 16);
  for (const images of [['a'], [pixels.toString('base64')], [png.subarray(0, 24).toString('base64')], Array(3).fill(png.toString('base64'))]) {
    assert.equal((await f.send('navi', '/api/chat', chat(vision, 'synthetic', images))).status, 400);
  }
  assert.equal((await f.send('navi', '/api/chat', chat('qwen3.5:4b', 'synthetic', [png.toString('base64')]))).status, 403);
  assert.deepEqual(f.records, []);
  assert.equal((await f.send('navi', '/api/chat', chat(vision, 'synthetic', [png.toString('base64')]))).status, 200);
});

test('one shared slot alternates projects, keeps FIFO, and waits for unload', async t => {
  const block = deferred();
  const f = await fixture(t, { unloadDelay: 55, async handle(input) {
    if (input.messages[0].content === 'N1') await block.promise;
  } });
  const active = f.send('navi', '/api/chat', chat(text, 'N1'));
  await until(() => f.records.length === 1);
  const n2 = f.send('navi', '/api/chat', chat(text, 'N2'));
  await sleep(30);
  const a1 = f.send('adrift', '/api/chat', chat(vision, 'A1'));
  await sleep(30);
  const a2 = f.send('adrift', '/api/chat', chat(vision, 'A2'));
  await sleep(35);
  block.resolve();
  for (const reply of await Promise.all([active, n2, a1, a2])) assert.equal(reply.status, 200);
  assert.deepEqual(f.records, ['N1', 'A1', 'N2', 'A2']);
  assert.equal(f.peak(), 1);
  assert.ok(f.events.every(event => event.durationMs >= 50));
});

test('queued cancel and expiry never reach the GPU; active disconnect drains', async t => {
  const block = deferred();
  const f = await fixture(t, { waitMs: 120, async handle(input) {
    if (input.messages[0].content === 'running') await block.promise;
  } });
  const conn = new AbortController();
  const active = f.send('navi', '/api/chat', chat(text, 'running'), conn.signal);
  await until(() => f.records.length === 1);
  const queued = new AbortController();
  const abandoned = f.send('adrift', '/api/chat', chat(vision, 'cancelled'), queued.signal);
  await sleep(30);
  queued.abort();
  await assert.rejects(abandoned, { name: 'AbortError' });
  conn.abort();
  await assert.rejects(active, { name: 'AbortError' });
  const expired = await f.send('adrift', '/api/chat', chat(vision, 'expired'));
  assert.equal(expired.status, 429);
  assert.equal((await expired.json()).code, 'queue_timeout');
  assert.deepEqual(f.records, ['running']);
  block.resolve();
  await until(() => f.events.length === 1);
  assert.equal((await f.send('adrift', '/api/chat', chat(vision, 'safe'))).status, 200);
  assert.equal(f.peak(), 1);
});

test('an ambiguous upstream timeout stops dispatch rather than opening a second slot', async t => {
  const block = deferred();
  const f = await fixture(t, { totalMs: 160, waitMs: 100, async handle() { await block.promise; } });
  t.after(() => block.resolve());
  assert.equal((await f.send('navi', '/api/chat', chat(text, 'stalled'))).status, 504);
  await until(() => f.events[0]?.recoveryRequired);
  const denied = await f.send('adrift', '/api/chat', chat(vision, 'rejected'));
  assert.equal(denied.status, 503);
  assert.equal((await denied.json()).code, 'recovery_required');
  assert.deepEqual(f.records, ['stalled']);
});

test('resident model blocks further work if unload has not been confirmed', async t => {
  const f = await fixture(t, { sticky: true, unloadMs: 60 });
  assert.equal((await f.send('navi', '/api/chat', chat(text, 'stuck runner'))).status, 503);
  assert.equal((await f.send('adrift', '/api/chat', chat(vision, 'second'))).status, 503);
  assert.deepEqual(f.records, ['stuck runner']);
});

test('project budget and ingress limits cannot take another project capacity', async t => {
  const block = deferred();
  const f = await fixture(t, { clients: { ...clients, navi: { ...clients.navi, rpm: 2, pending: 1 } },
    async handle(input) { if (input.messages?.[0].content === 'first') await block.promise; },
  });
  const active = f.send('navi', '/api/chat', chat(text, 'first'));
  await until(() => f.records.length === 1);
  assert.equal((await f.send('navi', '/api/chat', chat(text, 'flood'))).status, 429);
  const other = f.send('adrift', '/api/generate', { model: vision, prompt: 'legacy generate', stream: false });
  block.resolve();
  assert.equal((await active).status, 200);
  assert.equal((await other).status, 200);
  assert.equal((await f.send('navi', '/api/chat', chat(text, 'second'))).status, 200);
  assert.equal((await f.send('navi', '/api/chat', chat(text, 'budget'))).status, 429);
  assert.deepEqual(f.records, ['first', 'legacy generate', 'second']);
});

test('production client checks broker handshake before transmitting generation bytes', async t => {
  let rawRequests = 0;
  const direct = await listening(t, createServer((_req, res) => { rawRequests++; res.end('{"version":"test"}'); }));
  const transport = createOllamaTransport(direct, {}, { requireBroker: true });
  await assert.rejects(transport('/api/chat', { payload: chat(text, 'never send') }), /broker was not verified/);
  assert.equal(rawRequests, 1);
});

test('Adrift adapter injects its identity only for private allowed routes', async () => {
  const send = adriftBrokerFetch(clients.adrift.token, async (url, options) => ({ url, options }));
  const response = await send('http://127.0.0.1:11437/api/generate', { headers: { 'X-Request-ID': 'synthetic' } });
  assert.equal(response.options.headers.get('Authorization'), 'Bearer ' + clients.adrift.token);
  assert.equal(response.options.headers.get('X-Request-ID'), 'synthetic');
  assert.equal(response.options.redirect, 'error');
  assert.throws(() => send('http://127.0.0.1:11434/api/chat'));
  assert.throws(() => send('http://127.0.0.1:11437/api/pull'));
});
