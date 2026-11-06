import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { createInferenceBroker } from './server.mjs';
import { adriftBrokerFetch } from './adrift-transport.mjs';

const source = process.env.ADRIFT_SOURCE_DIR;
const model = 'qwen3.5:4b-q4_K_M';
const text = 'qwen3:4b-instruct-2507-q4_K_M';
const privateToken = 'a'.repeat(43);
const externalToken = 'z'.repeat(43);
const naviToken = 'n'.repeat(43);
async function listen(t, server) {
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + server.address().port;
}
const quiet = { info() {}, warn() {} };

test('installed Adrift gateway sources retain text, generate, cancellation, deadline and provider errors with the broker',
  { skip: source ? false : 'Set ADRIFT_SOURCE_DIR to an isolated Adrift source checkout' }, async t => {
    const load = path => import(pathToFileURL(resolve(source, path)));
    const { createLocalAiGateway } = await load('src/local-ai/server.js');
    const { createOllamaProvider } = await load('src/services/ollama.js');
    const { createAiCapacity } = await load('src/services/aiCapacity.js');
    let running = [], calls = [], release;
    const upstream = await listen(t, createServer(async (req, res) => {
      if (req.url === '/api/version') return res.end('{"version":"test"}');
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: running }));
      if (req.url === '/api/show') return res.end('{"capabilities":["completion","vision"]}');
      const parts = [];
      for await (const part of req) parts.push(part);
      const body = JSON.parse(Buffer.concat(parts).toString());
      const message = body.prompt ?? body.messages.at(-1).content;
      calls.push(message);
      assert.equal(body.keep_alive, 0);
      running = [{ name: body.model }];
      if (message === 'slow') await new Promise(resolve => { release = resolve; });
      if (message === 'timeout') await sleep(340);
      running = [];
      if (message === 'fail') { res.writeHead(503); return res.end('{"error":"synthetic offline"}'); }
      res.end(JSON.stringify({ model: body.model, done: true, done_reason: 'stop', response: 'test result',
        message: { role: 'assistant', content: 'test result' }, prompt_eval_count: 5, eval_count: 2 }));
    }));
    const broker = await listen(t, createInferenceBroker({ upstream, waitMs: 400, totalMs: 1500, pollMs: 5, clients: {
      adrift: { token: privateToken, text: [model], vision: [], rpm: 25, pending: 4 },
      navi: { token: naviToken, text: [text], vision: [model], rpm: 25, pending: 4 },
    } }));
    const provider = createOllamaProvider({ target: 'ollama', baseUrl: 'http://127.0.0.1:11437',
      fetchImpl: adriftBrokerFetch(privateToken, (url, options) => fetch(broker + url.pathname, options)), logger: quiet });
    const capacity = createAiCapacity({ waitMs: 150, totalMs: 260 });
    const gateway = createLocalAiGateway({ clients: [{ project: 'adrift', token: externalToken }], provider, capacity, logger: quiet });
    const app = await listen(t, createServer(gateway.app));
    function send(path, id, data, { method = 'POST', subject = 'c'.repeat(64), token = externalToken } = {}) {
      return fetch(app + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
        'X-Request-ID': id, 'X-AI-Subject': subject, 'X-AI-Feature': 'smoke' },
      ...(data ? { body: JSON.stringify(data) } : {}) });
    }
    const chat = content => ({ messages: [{ role: 'user', content }] });
    await t.test('health and legacy responses keep their contract', async () => {
      const health = await send('/health', 'health', null, { method: 'GET' });
      assert.equal(health.status, 200);
      assert.equal((await health.json()).upstream.model, model);
      for (const [kind, data] of [['chat', chat('text')], ['generate', { prompt: 'generate' }]]) {
        const reply = await send('/v1/' + kind, kind, data);
        assert.equal(reply.status, 200);
        const output = await reply.json();
        assert.equal(output.model, model);
        assert.equal(output.text, 'test result');
        assert.equal(output.metrics.outputTokens, 2);
        assert.equal(output.requestId, kind);
      }
      assert.equal((await send('/v1/chat', 'bad', chat('unused'), { token: privateToken })).status, 401);
    });
    await t.test('cross-subject cancellation is denied and correct cancellation drains globally', async () => {
      const pending = send('/v1/chat', 'slow', chat('slow'));
      for (let i = 0; !release && i < 35; i++) await sleep(5);
      assert.equal(typeof release, 'function');
      try {
        const foreign = await send('/v1/requests/slow', 'foreign', null, { method: 'DELETE', subject: 'd'.repeat(64) });
        assert.equal((await foreign.json()).cancelled, false);
        const owner = await send('/v1/requests/slow', 'owner', null, { method: 'DELETE' });
        assert.equal((await owner.json()).cancelled, true);
        const cancelled = await pending;
        assert.notEqual(cancelled.status, 200);
        const next = fetch(broker + '/api/chat', { method: 'POST', headers: {
          Authorization: 'Bearer ' + naviToken, 'Content-Type': 'application/json',
        }, body: JSON.stringify({ model: text, stream: false, ...chat('navi follows') }) });
        await sleep(25);
        assert.equal(calls.at(-1), 'slow');
        release();
        assert.equal((await next).status, 200);
      } finally { release(); }
    });
    await t.test('upstream error and deadline are not reported as success', async () => {
      const failed = await send('/v1/chat', 'fail', chat('fail'));
      assert.equal(failed.status, 503);
      assert.equal((await failed.json()).code, 'provider_unavailable');
      const timed = await send('/v1/chat', 'timeout', chat('timeout'));
      assert.equal(timed.status, 504);
      assert.equal((await timed.json()).code, 'timeout');
      assert.equal(capacity.state().recoveryRequired, true);
    });
  });
