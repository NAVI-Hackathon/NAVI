import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../src/config/env.js';
import { assertFreeProvider, createAIRequestBudget } from '../src/ai/costGuard.js';
import { createAIProvider } from '../src/ai/provider.js';
import { createGeminiProvider } from '../src/services/gemini.service.js';
import { understandIntent } from '../src/services/intent.service.js';
import { answerKnowledge } from '../src/services/knowledgeAnswerService.js';
import { enhanceHandoff } from '../src/services/handoffService.js';
import { createApp } from '../src/app.js';
import { createEvaluationCache, evaluationCacheKey } from '../eval/cache.js';
import { loadDataset, liveSamples, evaluateLocal, evaluateLive } from '../eval/runner.js';
import { PROMPT_VERSIONS } from '../src/ai/prompts/versions.js';
import { result } from './fixtures.js';

const config = { ...loadConfig({ AI_MODE: 'live', GEMINI_API_KEY: 'synthetic-test-key', GEMINI_FREE_TIER_CONFIRMED: 'true' }), rateLimitBackoffMs: 10 };
const response = raw => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] }));
const run = promisify(execFile);
const childEnv = overrides => ({ ...process.env, AI_MODE: 'demo', ALLOW_PAID_AI: 'false', GEMINI_API_KEY: '', GEMINI_FREE_TIER_CONFIRMED: 'false', GEMINI_MODEL: config.model, LIVE_AI_REQUEST_LIMIT: '12', ...overrides });
async function temporary(t) { const directory = await mkdtemp(join(tmpdir(), 'navi-synthetic-cache-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }

test('Zero-cost defaults keep Demo available without credentials or network', async () => {
  const defaults = loadConfig({}); assert.equal(defaults.aiMode, 'demo'); assert.equal(defaults.liveRequestLimit, 12);
  assert.equal(defaults.allowPaidAI, false); assert.equal(defaults.freeTierConfirmed, false);
  assert.equal((await createAIProvider(defaults).understandIntent('我的班機延誤了')).serviceType, 'flight_delay');
});
test('Paid flag/provider and invalid budget configuration fail closed', () => {
  assert.throws(() => loadConfig({ ALLOW_PAID_AI: 'true' }));
  assert.throws(() => assertFreeProvider({ requiresPaidTier: true }), { code: 'PAID_AI_DISABLED' });
  for (const value of ['0', '-1', '1.5', 'NaN', '1001']) assert.throws(() => loadConfig({ LIVE_AI_REQUEST_LIMIT: value }));
});
for (const [label, override, code] of [
  ['unconfirmed Free Tier', { freeTierConfirmed: false }, 'FREE_TIER_NOT_CONFIRMED'],
  ['paid/unknown model', { model: 'gemini-pro' }, 'PAID_AI_DISABLED'],
  ['CI', { ci: true }, 'LIVE_AI_DISABLED_IN_CI'],
  ['paid flag', { allowPaidAI: true }, 'PAID_AI_DISABLED'],
]) test(`${label} blocks the transport before any request`, async () => {
  let calls = 0;
  const provider = createGeminiProvider({ ...config, ...override }, async () => { calls++; return response(result()); });
  await assert.rejects(understandIntent('班機延誤', { provider, config }), { code });
  assert.equal(calls, 0); assert.equal(provider.getRequestBudget().used, 0);
});
test('Retries consume the same hard budget and cannot reset it', async () => {
  let calls = 0; const budget = createAIRequestBudget(2);
  const provider = createGeminiProvider(config, async () => { calls++; return new Response('{}', { status: 503 }); }, { budget });
  await assert.rejects(understandIntent('班機延誤', { provider, config }), { code: 'AI_PROVIDER_ERROR' });
  await assert.rejects(provider.understandIntent('另一個問題'), { code: 'AI_REQUEST_BUDGET_REACHED' });
  assert.equal(calls, 2); assert.equal(budget.status().remaining, 0);
  const snapshot = budget.status(); snapshot.used = 0; assert.equal(budget.status().used, 2);
});
test('Parallel requests cannot exceed a shared budget', async () => {
  let calls = 0; const budget = createAIRequestBudget(2);
  const provider = createGeminiProvider(config, async () => { calls++; return response(result()); }, { budget });
  const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => provider.understandIntent('班機延誤')));
  assert.equal(calls, 2); assert.equal(outcomes.filter(entry => entry.status === 'fulfilled').length, 2);
  assert.ok(outcomes.filter(entry => entry.status === 'rejected').every(entry => entry.reason.code === 'AI_REQUEST_BUDGET_REACHED'));
});
test('429 backs off once, then stops all further outbound requests', async () => {
  const starts = []; const provider = createGeminiProvider(config, async () => { starts.push(performance.now()); return new Response('{}', { status: 429 }); });
  await assert.rejects(understandIntent('班機延誤', { provider, config }), { code: 'AI_RATE_LIMITED', retryable: false });
  assert.equal(starts.length, 2); assert.ok(starts[1] - starts[0] >= 8);
  assert.equal(provider.getRequestBudget().stopped, 'AI_RATE_LIMITED');
  await assert.rejects(provider.understandIntent('班機延誤'), { code: 'AI_RATE_LIMITED' }); assert.equal(starts.length, 2);
});
test('A single transient 429 can recover without changing provider or model', async () => {
  let calls = 0; const provider = createGeminiProvider(config, async url => {
    assert.ok(url.includes(config.model)); return ++calls === 1 ? new Response('{}', { status: 429 }) : response(result());
  });
  assert.equal((await understandIntent('班機延誤', { provider, config })).data.serviceType, 'flight_delay');
  assert.equal(calls, 2); assert.equal(provider.getRequestBudget().used, 2);
});
test('HTTP quota error is sanitized and retryable=false after backoff', async t => {
  const provider = createGeminiProvider(config, async () => new Response('private provider details', { status: 429 }));
  const server = createApp(config, provider).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/analyze-intent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '班機延誤' }) });
  assert.equal(res.status, 429); const body = await res.json(); assert.equal(body.error.code, 'AI_RATE_LIMITED'); assert.equal(body.error.retryable, false);
  assert.ok(!JSON.stringify(body).includes('private provider details'));
});
test('Knowledge and handoff never hide quota exhaustion behind template success', async () => {
  const provider = createGeminiProvider(config, async () => new Response('{}', { status: 429 }));
  await assert.rejects(answerKnowledge('為什麼需要延誤證明？', { provider, config }), { code: 'AI_RATE_LIMITED' });
  await assert.rejects(enhanceHandoff({ issue: '班機延誤', summary: '合成測試', reason: '待確認', collected: [], missing: [] }, { provider, config }), { code: 'AI_RATE_LIMITED' });
  assert.equal(provider.getRequestBudget().used, 2);
});
test('Cache keys change with model, prompt version, input, schema and prompt text', () => {
  const args = [config.model, 'intent', 'prompt', [{ text: 'synthetic' }], { type: 'object' }];
  const key = evaluationCacheKey(...args);
  assert.match(key, /^[a-f0-9]{64}$/);
  for (const changed of [ ['other', ...args.slice(1)], [args[0], args[1], 'changed', ...args.slice(3)], [ ...args.slice(0, 3), [{ text: 'changed' }], args[4] ], [ ...args.slice(0, 4), { type: 'string' } ] ]) assert.notEqual(evaluationCacheKey(...changed), key);
  assert.notEqual(evaluationCacheKey(...args, { ...PROMPT_VERSIONS, intent: 'intent-v3' }), key);
});
test('Valid synthetic cache replay uses zero requests and does not double-adjust confidence', async t => {
  const directory = await temporary(t); const cache = createEvaluationCache(config.model, { directory }); let calls = 0;
  const transport = async () => { calls++; return response(result()); };
  const first = await createGeminiProvider(config, transport, { cache }).understandIntent('synthetic flight delay');
  const replay = createGeminiProvider(config, transport, { cache });
  assert.deepEqual(await replay.understandIntent('synthetic flight delay'), first); assert.equal(calls, 1); assert.equal(replay.getRequestBudget().used, 0);
  const stored = await readFile(join(directory, (await readdir(directory))[0]), 'utf8');
  assert.ok(!stored.includes(config.apiKey)); assert.ok(!stored.includes('synthetic flight delay')); assert.equal(JSON.parse(stored).synthetic, true);
});
test('Refresh skips stored responses; corrupt/invalid caches still need schema validation and budget', async t => {
  const directory = await temporary(t); let calls = 0; const transport = async () => { calls++; return response(result()); };
  await createGeminiProvider(config, transport, { cache: createEvaluationCache(config.model, { directory }) }).understandIntent('synthetic');
  await createGeminiProvider(config, transport, { cache: createEvaluationCache(config.model, { directory, refresh: true }) }).understandIntent('synthetic'); assert.equal(calls, 2);
  const path = join(directory, (await readdir(directory))[0]);
  const stored = JSON.parse(await readFile(path, 'utf8')); stored.response.readiness = 100; await writeFile(path, JSON.stringify(stored));
  await createGeminiProvider(config, transport, { cache: createEvaluationCache(config.model, { directory }) }).understandIntent('synthetic'); assert.equal(calls, 3);
  await writeFile(path, 'not-json');
  await createGeminiProvider(config, transport, { cache: createEvaluationCache(config.model, { directory }) }).understandIntent('synthetic'); assert.equal(calls, 4);
});
test('Cache storage failure cannot trigger another paid or live request', async () => {
  let calls = 0; const cache = { read: async () => null, write: async () => { throw new Error('storage unavailable'); } };
  const provider = createGeminiProvider(config, async () => { calls++; return response(result()); }, { cache });
  assert.equal((await understandIntent('班機延誤', { provider, config })).data.serviceType, 'flight_delay'); assert.equal(calls, 1);
});
test('120 authored local cases and Golden Path pass with no Gemini requests', async () => {
  const report = await evaluateLocal(await loadDataset(), loadConfig({}));
  assert.equal(report.total, 120); assert.equal(report.failed, 0); assert.equal(report.requests, 0);
  assert.deepEqual(report.goldenPath, [35, 70, 90, 100]); assert.equal(report.liveLatencyMs.p50, null);
});
test('Fixed live sample has nine cases; cached replay is reported separately from fresh calls', async t => {
  const cases = liveSamples(await loadDataset()); assert.equal(cases.length, 9);
  const cache = createEvaluationCache(config.model, { directory: await temporary(t) }); let calls = 0;
  const transport = async (url, options) => {
    calls++; const parts = JSON.parse(options.body).contents[0].parts;
    if (parts[1]?.inlineData) {
      const type = Buffer.from(parts[1].inlineData.data, 'base64').includes(Buffer.from('BOARDING PASS')) ? 'boarding_pass' : 'delay_certificate';
      return response(cases.find(entry => entry.sampleType === type).output);
    }
    if (parts[0].text.startsWith('{')) {
      const { context } = JSON.parse(parts[0].text); return response({ answer: context.answer, confidence: .9, supported: true, sourceIds: context.sourceIds });
    }
    return response(cases.find(entry => entry.message === parts[0].text).output);
  };
  const firstBudget = createAIRequestBudget(12);
  const first = await evaluateLive(cases, { config, budget: firstBudget, provider: createGeminiProvider(config, transport, { cache, budget: firstBudget }) });
  assert.equal(first.failed, 0); assert.equal(first.requests, 9); assert.equal(first.freshLiveSamples, 9);
  const secondBudget = createAIRequestBudget(12);
  const second = await evaluateLive(cases, { config, budget: secondBudget, provider: createGeminiProvider(config, transport, { cache, budget: secondBudget }) });
  assert.equal(second.failed, 0); assert.equal(second.requests, 0); assert.equal(second.cachedSamples, 9); assert.equal(second.liveLatencyMs.p50, null); assert.equal(calls, 9);
});
test('Document sample evaluation rejects wrong visible facts even when evidence can verify', async () => {
  const entry = liveSamples(await loadDataset()).find(entry => entry.sampleType === 'boarding_pass');
  for (const changes of [{ flightNumber: 'CI100' }, { origin: 'HND' }, { passengerName: null }, { departureDate: '2026-10-08' }, { scheduledDeparture: '14:25' }]) {
    const raw = { ...entry.output, fields: { ...entry.output.fields, ...changes } };
    const budget = createAIRequestBudget(12);
    const provider = createGeminiProvider(config, async () => response(raw), { budget });
    const report = await evaluateLive([entry], { provider, config, budget });
    assert.equal(report.failed, 1); assert.equal(report.requests, 1);
  }
});
test('Live evaluation stops on exhausted quota and skips remaining samples', async () => {
  const budget = createAIRequestBudget(12); let calls = 0;
  const provider = createGeminiProvider(config, async () => { calls++; return new Response('{}', { status: 429 }); }, { budget });
  const report = await evaluateLive(liveSamples(await loadDataset()), { provider, config, budget });
  assert.equal(report.stopped, 'AI_RATE_LIMITED'); assert.equal(report.requests, 2); assert.equal(report.total, 1); assert.equal(report.skipped, 8); assert.equal(calls, 2);
});
test('Offline network guard rejects external transport', () => {
  assert.throws(() => fetch('https://generativelanguage.googleapis.com/'), { code: 'OFFLINE_TEST_NETWORK_BLOCKED' });
});
test('Status and live plan are offline; CI and unconfirmed live commands fail closed', async () => {
  const status = JSON.parse((await run(process.execPath, ['scripts/ai-status.js'], { env: childEnv(), timeout: 30000 })).stdout);
  assert.equal(status.requestsSent, 0); assert.equal(status.paidFallback, 'disabled'); assert.equal(status.externalPaidProviders, 0); assert.equal(status.liveAllowed, false);
  const plan = await run(process.execPath, ['eval/cli.js', '--live', '--plan'], { env: childEnv(), timeout: 30000 });
  assert.ok(plan.stdout.includes('Requests planned (before cache): 9')); assert.ok(plan.stdout.includes('"requestsSent": 0'));
  for (const [env, code] of [[childEnv({ CI: 'false' }), 'FREE_TIER_NOT_CONFIRMED'], [childEnv({ CI: 'true', GEMINI_FREE_TIER_CONFIRMED: 'true', GEMINI_API_KEY: 'synthetic-test-key' }), 'LIVE_AI_DISABLED_IN_CI']]) {
    await assert.rejects(run(process.execPath, ['--import', './test/networkGuard.js', 'eval/cli.js', '--live'], { env, timeout: 30000 }), error => error.code === 1 && error.stderr.includes(code));
  }
});
