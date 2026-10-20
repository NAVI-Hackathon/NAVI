import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createGeminiProvider } from '../src/services/gemini.service.js';
import { requestValidatedAI } from '../src/services/providerRequest.js';
import { answerKnowledge } from '../src/services/knowledgeAnswerService.js';
import { ApiError } from '../src/middleware/errorHandler.js';
import { offlineNetworkStats } from './networkGuard.js';

const config = { ...loadConfig({ AI_MODE: 'live', GEMINI_API_KEY: 'synthetic-test-key', GEMINI_FREE_TIER_CONFIRMED: 'true' }), timeoutMs: 40 };
test('HTTP intent request deadline also covers a hung provider response body', async t => {
  let requests = 0;
  const provider = createGeminiProvider(config, async () => { requests++; return { ok: true, status: 200, json: () => new Promise(() => {}) }; });
  const server = createApp(config, provider).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/analyze-intent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '我住院五天要申請理賠' }) });
  assert.equal(response.status, 504); const body = await response.json(); assert.equal(body.error.code, 'AI_TIMEOUT');
  assert.equal(body.error.retryable, true); assert.match(body.error.message, /重新嘗試/); assert.equal(requests, 1);
  assert.ok(performance.now() - started < 1000); assert.equal(offlineNetworkStats().externalRequests, 0);
});
test('retry shares the original deadline and never restarts a full timeout', async () => {
  let attempts = 0, aborted = false;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(requestValidatedAI(async signal => {
      if (++attempts === 1) throw new ApiError('AI_PROVIDER_ERROR', 'synthetic', 503, true);
      signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {});
    }, { config }), error => error.code === 'AI_TIMEOUT');
    assert.equal(attempts, 2); assert.equal(aborted, true);
  } finally { clearTimeout(keepAlive); }
});
test('timed-out knowledge uses only verified local evidence, without substituting demo claims', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const answer = await answerKnowledge('如何修改通訊地址', { provider: { mode: 'live', answerKnowledge: () => new Promise(() => {}) }, config });
    assert.equal(answer.answerMode, 'retrieval_template'); assert.equal(answer.isMock, false); assert.ok(answer.sources.every(s => s.type === 'public_site_snapshot'));
    assert.doesNotMatch(answer.answer, /待確認|頁面寫紙本/);
  } finally { clearTimeout(keepAlive); }
});
