import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { createOllamaProvider } from '../src/ai/ollamaProvider.js';
import { loadConfig } from '../src/config/env.js';
import { fixture, store } from './mongoTestSupport.js';

test('Ollama product uses versioned consent and durable quota, preserves provenance and stays retrieval-only on loss', async t => {
  const f = fixture(t);
  const origin = 'https://app.navitw.com';
  const config = loadConfig({
    AI_MODE: 'live', AI_PROVIDER: 'ollama', NAVI_PRODUCT_MODE: 'true', AI_PUBLIC_SYNTHETIC: 'true',
    AI_SYNTHETIC_TEST_ONLY: 'true', WEB_ORIGINS: origin, AI_DAILY_REQUEST_LIMIT: '2',
    MONGODB_URI: f.uri, MONGODB_DATABASE: f.database, NAVI_DATA_ENCRYPTION_KEY: f.key, NAVI_PRIVATE_STATE_PATH: f.dir,
  });
  config.store = await store(f);
  let sends = 0;
  let offline = false;
  const provider = createOllamaProvider(config, async (path, { payload }) => {
    if (path === '/api/version') return offline ? { status: 502 } : { status: 200, body: '{"version":"test-only"}' };
    sends++;
    if (offline) throw Error('fixture disconnected');
    const content = { intent: 'service_request', serviceType: 'policy_change', confidence: .95,
      summary: '使用者希望變更通訊地址',
      extractedData: { origin: null, destination: null, delayMinutes: null, incidentDate: null } };
    return { status: 200, body: JSON.stringify({ model: payload.model, done: true, done_reason: 'stop',
      message: { role: 'assistant', content: JSON.stringify(content) } }) };
  });
  const app = createApp(config, provider);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await app.locals.close();
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/api';
  let cookie = '';
  async function request(path, body, optedIn = true) {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { Origin: origin, Cookie: cookie, ...(optedIn ? { 'X-NAVI-Contract': 'judge-v1' } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
    return { status: response.status, mode: response.headers.get('X-NAVI-AI-Mode'), body: await response.json() };
  }
  const profile = (await request('/session')).body;
  assert.equal(profile.disclosureVersion, 'ollama-local-synthetic-2026-11');
  assert.deepEqual(profile.documentUpload, { builtInSynthetic: false, userProvidedSynthetic: false, realPersonalDocuments: false });
  assert.deepEqual((await request('/ai/status')).body.documentUpload, profile.documentUpload);
  assert.equal((await request('/session/consent', { syntheticOnly: true, disclosureVersion: 'gemini-unpaid-2026-10' })).status, 400);
  assert.equal((await request('/session/consent', { syntheticOnly: true, disclosureVersion: profile.disclosureVersion })).status, 200);
  const message = '我要變更保單通訊地址。';
  assert.equal((await request('/intelligence/understand', { message }, false)).status, 503);
  const intent = await request('/intelligence/understand', { message });
  assert.equal(intent.status, 200);
  assert.equal(intent.body.meta.source, 'ollama');
  assert.equal(sends, 1);

  offline = true;
  const status = await request('/ai/status');
  assert.equal(status.mode, 'unavailable');
  assert.equal(status.body.backend, 'ollama');
  const reply = await request('/conversations/messages', { message, requestId: randomUUID() });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.mode, 'retrieval');
  assert.equal(reply.body.errorCode, 'AI_PROVIDER_ERROR');
  assert.equal(reply.body.understanding, null);
  assert.ok(reply.body.evidence.results.some(result => result.source.id === 'service:change_address'));
  assert.equal(sends, 2);

  const capped = await request('/intelligence/understand', { message });
  assert.equal(capped.status, 429);
  assert.equal(capped.body.error.code, 'AI_DAILY_LIMIT_REACHED');
  assert.equal(sends, 2);
  const usage = await config.store.db.collection('usage_budgets').findOne({ kind: 'requests' });
  assert.equal(usage.used, 2);
});
