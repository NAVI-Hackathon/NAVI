import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDurableQuota } from '../src/ai/durableQuota.js';
import { createAIProvider } from '../src/ai/provider.js';
import { createGeminiProvider } from '../src/services/gemini.service.js';
import { createDemoProvider } from '../src/ai/demoProvider.js';
import { loadConfig } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createJourneyService } from '../src/services/journeyService.js';
import { InMemoryJourneyRepository } from '../src/repositories/inMemoryJourneyRepository.js';
import { understandIntent } from '../src/services/intent.service.js';
import { normalizeGeminiDocument } from '../src/ai/schemas.js';
import { samplePdf } from './sampleDocuments.js';
import { result } from './fixtures.js';
import { analyzeDocument, parseUpload } from '../src/services/documentService.js';
import { answerKnowledge } from '../src/services/knowledgeAnswerService.js';
import { enhanceHandoff } from '../src/services/handoffService.js';
import { ApiError } from '../src/middleware/errorHandler.js';
import { offlineNetworkStats } from './networkGuard.js';

const story = '我上週在台中榮總住院五天，要怎麼申請理賠？';
const token = 'synthetic-operator-token-at-least-32-characters';
const origin = 'https://app.navitw.com';
const config = { ...loadConfig({ AI_MODE: 'live', GEMINI_API_KEY: 'synthetic-test-key', GEMINI_FREE_TIER_CONFIRMED: 'true', AI_MAX_ATTEMPTS: '1' }), rateLimit: 300 };
const response = raw => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] }));
function ledger(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'navi-quota-test-')); chmodSync(dir, 0o700);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const settings = { file: join(dir, 'usage.json'), dailyLimit: 2, intervalMs: 0, ...options };
  return { settings, quota: createDurableQuota(settings) };
}
async function serve(t, settings, provider) {
  const app = createApp(settings, provider); const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (path, body, cookie, extra = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: JSON.stringify(body) });
  async function session() { const res = await post('/test-sessions', { token, syntheticOnly: true }); assert.equal(res.status, 201); const cookie = res.headers.get('set-cookie'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/); return cookie.split(';')[0]; }
  return { base, post, session };
}
const restricted = () => ({ ...config, restrictedLive: true, sessionToken: token, origins: [origin] });

test('Production demo flags fail closed; local demo never loads Gemini', async () => {
  const provider = createAIProvider(loadConfig({ NODE_ENV: 'production', AI_MODE: 'demo' }));
  assert.equal(provider.mode, 'unavailable');
  await assert.rejects(provider.analyzeDocument({}), { code: 'AI_UNAVAILABLE' });
  assert.equal(createAIProvider(loadConfig({})).mode, 'demo');
  assert.throws(() => createApp({ ...config, production: true }, createDemoProvider()));
});
test('Missing Free Tier or durable budget/session settings cannot enable public live', () => {
  for (const extra of [{}, { GEMINI_FREE_TIER_CONFIRMED: 'true' }, { GEMINI_FREE_TIER_CONFIRMED: 'true', NAVI_TEST_SESSION_TOKEN: token }]) {
    assert.equal(createAIProvider(loadConfig({ NODE_ENV: 'production', AI_MODE: 'live', GEMINI_API_KEY: 'synthetic', ...extra })).mode, 'unavailable');
  }
  for (const key of ['AI_DAILY_REQUEST_LIMIT', 'AI_MAX_CONCURRENT', 'AI_MAX_ATTEMPTS']) assert.throws(() => loadConfig({ [key]: '1.5' }));
});
test('Durable daily quota, restart, concurrency and Pacific day rollover', t => {
  let time = Date.parse('2026-10-25T12:00:00Z');
  const { quota, settings } = ledger(t, { now: () => time });
  const first = quota.acquire();
  assert.throws(() => createDurableQuota(settings).acquire(), { code: 'AI_BUSY' });
  quota.release(first);
  const afterRestart = createDurableQuota(settings); const second = afterRestart.acquire(); afterRestart.release(second);
  assert.throws(() => createDurableQuota(settings).acquire(), { code: 'AI_DAILY_LIMIT_REACHED' });
  time += 86400000;
  const third = quota.acquire(); quota.release(third);
  assert.equal(JSON.parse(readFileSync(settings.file)).used, 1);
  time -= 86400000;
  assert.throws(() => quota.acquire(), { code: 'AI_USAGE_UNAVAILABLE' });
});
test('Corrupt/insecure ledgers and occupied locks fail closed; no quota reset', t => {
  const { quota, settings } = ledger(t);
  writeFileSync(settings.file, '{invalid', { mode: 0o600 });
  assert.throws(() => quota.acquire(), { code: 'AI_USAGE_UNAVAILABLE' });
  rmSync(settings.file); writeFileSync(`${settings.file}.lock`, '', { mode: 0o600 });
  assert.throws(() => quota.acquire(), { code: 'AI_BUSY' });
  rmSync(`${settings.file}.lock`); chmodSync(join(settings.file, '..'), 0o755);
  assert.throws(() => quota.acquire(), { code: 'AI_USAGE_UNAVAILABLE' });
});
test('Retry failures count durably; a provider restart cannot regain consumed quota', async t => {
  const { settings } = ledger(t, { dailyLimit: 1 }); let calls = 0;
  const c = { ...config, usageFile: settings.file, dailyLimit: 1, maxConcurrent: 1 };
  const transport = async () => { calls++; return new Response('{}', { status: 503 }); };
  await assert.rejects(understandIntent(story, { config: c, provider: createGeminiProvider(c, transport) }), { code: 'AI_PROVIDER_ERROR' });
  await assert.rejects(understandIntent(story, { config: c, provider: createGeminiProvider(c, transport) }), { code: 'AI_DAILY_LIMIT_REACHED' });
  assert.equal(calls, 1);
});
test('Session required, hostile origins denied, browser mode headers ignored; unavailable never returns fixture', async t => {
  let calls = 0; const provider = { mode: 'live', understandIntent: async () => { calls++; return result(); } };
  const api = await serve(t, restricted(), provider);
  for (const path of ['/intelligence/understand', '/intelligence/tasks', '/intelligence/tasks/', '/intelligence/understand/', '/ANALYZE-INTENT/', '/knowledge/answer/']) assert.equal((await api.post(path, { message: story })).status, 403);
  const denied = await api.post('/test-sessions', { token, syntheticOnly: true }, null, { Origin: 'https://evil.invalid' }); assert.equal(denied.status, 403);
  const cookie = await api.session();
  const res = await api.post('/intelligence/understand', { message: '班機延誤' }, cookie, { 'X-NAVI-AI-Mode': 'demo' });
  assert.equal(res.headers.get('X-NAVI-AI-Mode'), 'live'); assert.equal((await res.json()).meta.source, 'gemini'); assert.equal(calls, 1);
  const closed = await serve(t, { ...restricted(), production: true, aiMode: 'demo' });
  const unavailable = await closed.post('/intelligence/understand', { message: story });
  assert.equal(unavailable.status, 503); assert.equal(unavailable.headers.get('X-NAVI-AI-Mode'), 'unavailable'); assert.equal((await unavailable.json()).error.code, 'AI_UNAVAILABLE');
});
test('Server intent receipt avoids duplicate calls; forged intentResult cannot control a live Journey', async t => {
  let calls = 0;
  const provider = { mode: 'live', understandIntent: async () => { calls++; return result('hospitalization_claim'); } };
  const api = await serve(t, restricted(), provider); const cookie = await api.session();
  const understood = await api.post('/intelligence/understand', { message: story }, cookie); assert.equal(understood.status, 200);
  const forged = result('flight_delay');
  const created = await api.post('/journeys', { message: story, intentResult: forged }, cookie); assert.equal(created.status, 201);
  const journey = await created.json(); assert.equal(journey.serviceType, 'hospitalization_claim'); assert.equal(journey.provider, 'live'); assert.equal(journey.readiness, 35); assert.equal(calls, 1);
  const otherCookie = await api.session();
  for (const suffix of ['', '/explanation', '/handoff-summary']) assert.equal((await fetch(`${api.base}/journeys/${journey.id}${suffix}`, { headers: { Cookie: otherCookie } })).status, 404);
  assert.equal((await api.post(`/journeys/${journey.id}/review`, { confirmed: true }, otherCookie)).status, 404);
  const modified = await api.post('/journeys', { message: '另一個住院案件', intentResult: forged }, cookie);
  assert.equal(modified.status, 409); assert.equal((await modified.json()).error.code, 'INTENT_RECEIPT_REQUIRED'); assert.equal(calls, 1);
  // Legacy direct creation remains possible, but never trusts browser-supplied analysis.
  const direct = await api.post('/journeys', { message: '另一個住院案件' }, cookie); assert.equal(direct.status, 201); assert.equal((await direct.json()).serviceType, 'hospitalization_claim'); assert.equal(calls, 2);
});
test('Actual bytes reach the transport; classification and isMock come from the provider, not declared type', async () => {
  const bytes = samplePdf('bank_passbook'); let calls = 0;
  const provider = createGeminiProvider(config, async (url, options) => {
    calls++; const body = JSON.parse(options.body); assert.equal(Buffer.from(body.contents[0].parts[1].inlineData.data, 'base64').equals(bytes), true);
    assert.equal(body.tools, undefined);
    return response({ documentType: 'bank_passbook', confidence: 0.98, fields: { passengerName: null, flightNumber: null, origin: null, destination: null, departureDate: null, actualDepartureDate: null, scheduledDeparture: null, actualDeparture: null, bankName: 'SYNTHETIC BANK', accountHolder: 'SYNTHETIC PATIENT', accountLast4: '1234' } });
  });
  const doc = await analyzeDocument({ bytes, documentType: 'diagnosis_certificate', mimeType: 'application/pdf', filename: 'x.pdf', size: bytes.length }, { provider, config });
  assert.equal(doc.documentType, 'bank_passbook'); assert.equal(doc.source, 'live'); assert.equal(doc.isMock, false); assert.equal(calls, 1);
});
test('Full account numbers are rejected by structured schema and never enter returned evidence', () => {
  assert.throws(() => normalizeGeminiDocument({ documentType: 'bank_passbook', confidence: .99, fields: { accountNumber: '12345678901234', accountLast4: '12345678901234' } }));
});
test('Unknown/blank/non-document analyses never become verified; low confidence remains needs_review', async () => {
  for (const kind of ['blank image', 'arbitrary photo', 'non-document']) {
    await assert.rejects(analyzeDocument({ filename: kind }, { provider: { mode: 'live', analyzeDocument: async () => ({ documentType: 'unknown', confidence: .2, fields: {} }) }, config }), { code: 'DOCUMENT_UNRECOGNIZED' });
  }
  const doc = await analyzeDocument({ filename: 'x', mimeType: 'application/pdf', size: 50 }, { provider: { mode: 'live', analyzeDocument: async () => ({ documentType: 'bank_passbook', confidence: .1, fields: { bankName: null, accountHolder: null, accountLast4: null } }) }, config });
  assert.equal(doc.status, 'needs_review'); assert.deepEqual(doc.matchedRequirements, []);
});
test('Corrupt PDF and MIME mismatch are rejected before provider calls', async () => {
  for (const [bytes, mime, code] of [[Buffer.from('%PDF-1.4 broken'), 'application/pdf', 'DOCUMENT_INVALID'], [samplePdf('diagnosis_certificate'), 'image/png', 'UNSUPPORTED_FILE_TYPE']]) {
    const form = new FormData(); form.set('file', new Blob([bytes], { type: mime }), 'synthetic');
    const req = new Request('http://127.0.0.1', { method: 'POST', body: form });
    await assert.rejects(parseUpload({ is: () => true, get: () => req.headers.get('Content-Type'), body: Buffer.from(await req.arrayBuffer()) }), { code });
  }
});
test('Live errors never invoke demo; timeout is bounded and retry disabled', async () => {
  let calls = 0; const c = { ...config, timeoutMs: 20 };
  const provider = createGeminiProvider(c, async (_url, options) => { calls++; return new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); }); });
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(understandIntent(story, { provider, config: c }), { code: 'AI_TIMEOUT' }); } finally { clearTimeout(keepAlive); }
  assert.equal(calls, 1);
});
test('Rate limiter remains active for authorized sessions', async t => {
  const api = await serve(t, { ...restricted(), rateLimit: 1 }, { mode: 'live' });
  await api.session(); const res = await api.post('/intelligence/understand', { message: story });
  assert.equal(res.status, 429); assert.equal((await res.json()).error.code, 'RATE_LIMITED');
});
test('Live bank contradiction is not silently discarded with manual information', async () => {
  const provider = { ...createDemoProvider(), mode: 'live' };
  const service = createJourneyService({ config, provider, repository: new InMemoryJourneyRepository() });
  const journey = await service.create({ message: story });
  service.addManualDocumentInformation(journey.id, { documentType: 'bank_passbook', fields: { accountLast4: '9999' } });
  const bytes = samplePdf('bank_passbook');
  await assert.rejects(service.addDocument(journey.id, { bytes, documentType: 'bank_passbook', mimeType: 'application/pdf', size: bytes.length }), { code: 'BANK_INFORMATION_MISMATCH' });
  assert.equal(service.get(journey.id).readiness, 35); assert.equal(service.get(journey.id).documents.length, 0);
});
test('CI tests made no external generation requests', () => { assert.equal(offlineNetworkStats().externalRequests, 0); });

test('Independent Node workers cannot race past the durable daily cap', async t => {
  const { settings } = ledger(t, { dailyLimit: 1 });
  const code = `import { createDurableQuota } from ${JSON.stringify(new URL('../src/ai/durableQuota.js', import.meta.url).href)}; try { const quota = createDurableQuota(${JSON.stringify(settings)}); const id = quota.acquire(); await new Promise(resolve => setTimeout(resolve, 100)); quota.release(id); console.log('reserved'); } catch (error) { console.log(error.code); }`;
  const results = await Promise.all(Array.from({ length: 6 }, () => promisify(execFile)(process.execPath, ['--input-type=module', '-e', code])));
  assert.equal(results.filter(result => result.stdout.trim() === 'reserved').length, 1);
  assert.ok(results.every(result => ['reserved', 'AI_BUSY', 'AI_DAILY_LIMIT_REACHED'].includes(result.stdout.trim())));
  assert.equal(JSON.parse(readFileSync(settings.file)).used, 1);
});

test('Durable quota failures are never hidden behind successful knowledge/handoff templates', async () => {
  for (const code of ['AI_DAILY_LIMIT_REACHED', 'AI_USAGE_UNAVAILABLE', 'AI_BUSY', 'AI_UNAVAILABLE']) {
    const fail = async () => { throw new ApiError(code, '合成測試', 503, false); };
    const provider = { mode: 'live', answerKnowledge: fail, summarizeHandoff: fail };
    await assert.rejects(answerKnowledge('為什麼需要延誤證明？', { provider, config }), { code });
    await assert.rejects(enhanceHandoff({ issue: '合成測試', summary: '合成摘要', collected: [], missing: [], reason: '待確認' }, { provider, config }), { code });
  }
});
