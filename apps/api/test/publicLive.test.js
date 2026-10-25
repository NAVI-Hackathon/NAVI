import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createAIProvider } from '../src/ai/provider.js';
import { createAIRequestBudget } from '../src/ai/costGuard.js';
import { createDemoProvider } from '../src/ai/demoProvider.js';
import { samplePdf } from './sampleDocuments.js';
import { offlineNetworkStats } from './networkGuard.js';

const origin = 'https://app.navitw.com';
const story = '我在 NAVI SYNTHETIC HOSPITAL 住院五天，想申請理賠。';
const fingerprint = bytes => createHash('sha256').update(bytes).digest('hex');
const config = () => ({ ...loadConfig({ NODE_ENV: 'production', AI_MODE: 'live', AI_PUBLIC_SYNTHETIC: 'true', GEMINI_API_KEY: 'synthetic-test-key', GEMINI_FREE_TIER_CONFIRMED: 'true', AI_USAGE_FILE: '/private/synthetic-ledger.json', WEB_ORIGINS: origin, AI_SYNTHETIC_DOCUMENT_SHA256: fingerprint(samplePdf('diagnosis_certificate')) }), rateLimit: 300, timeoutMs: 30 });
async function api(t, settings = config(), provider = { ...createDemoProvider(), mode: 'live' }) {
  const server = createApp(settings, provider).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (path, data, cookie, extra = {}) => fetch(base + path, { method: 'POST', headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...extra }, body: data instanceof FormData ? data : JSON.stringify(data) });
  return { base, post };
}

test('Public synthetic configuration remains opt-in, validates fingerprints and needs Free Tier', () => {
  assert.equal(loadConfig({}).publicSynthetic, false);
  assert.throws(() => loadConfig({ AI_PUBLIC_SYNTHETIC: 'true' }));
  assert.throws(() => loadConfig({ AI_SYNTHETIC_DOCUMENT_SHA256: 'not-a-hash' }));
  assert.equal(createAIProvider(config()).mode, 'live');
  assert.equal(createAIProvider({ ...config(), freeTierConfirmed: false }).mode, 'unavailable');
  assert.equal(createAIProvider({ ...config(), apiKey: '' }).mode, 'unavailable');
  assert.equal(createAIProvider({ ...config(), aiMode: 'demo' }).mode, 'unavailable');
});

test('Regular mode automatically issues an isolated cookie and reuses the server intent receipt', async t => {
  let calls = 0; const demo = createDemoProvider();
  const service = await api(t, config(), { ...demo, mode: 'live', understandIntent: async message => { calls++; return demo.understandIntent(message); } });
  const understood = await service.post('/intelligence/understand', { message: story });
  assert.equal(understood.status, 200); assert.equal(understood.headers.get('X-NAVI-AI-Mode'), 'live');
  const setCookie = understood.headers.get('set-cookie');
  for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(setCookie.includes(attribute));
  const cookie = setCookie.split(';')[0]; assert.equal((await understood.json()).meta.source, 'gemini');
  const created = await service.post('/journeys', { message: story }, cookie);
  assert.equal(created.status, 201); const journey = await created.json(); assert.equal(journey.readiness, 35); assert.equal(calls, 1);
  assert.equal((await fetch(service.base + '/journeys/' + journey.id, { headers: { Cookie: cookie } })).status, 200);
  const other = await service.post('/intelligence/understand', { message: story });
  const otherCookie = other.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(service.base + '/journeys/' + journey.id, { headers: { Cookie: otherCookie } })).status, 404);
  const status = await (await fetch(service.base + '/ai/status')).json(); assert.equal(status.access, 'public_synthetic');
});

test('Untrusted or absent origin cannot auto-create a public session or trigger a model', async t => {
  let calls = 0; const service = await api(t, config(), { mode: 'live', understandIntent: async () => { calls++; } });
  const absent = await fetch(service.base + '/intelligence/understand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: story }) });
  assert.equal(absent.status, 403); assert.equal(absent.headers.get('set-cookie'), null);
  const foreign = await service.post('/intelligence/understand', { message: story }, null, { Origin: 'https://evil.invalid' });
  assert.equal(foreign.status, 403); assert.equal(calls, 0);
});

test('Anonymous documents require approved bytes, not a filename or a browser claim', async t => {
  let calls = 0; const demo = createDemoProvider();
  const service = await api(t, config(), { ...demo, mode: 'live', analyzeDocument: async upload => { calls++; return demo.analyzeDocument(upload); } });
  const created = await service.post('/journeys', { message: story }); const cookie = created.headers.get('set-cookie').split(';')[0]; const journey = await created.json();
  const upload = bytes => { const form = new FormData(); form.set('file', new Blob([bytes], { type: 'application/pdf' }), 'NAVI-SYNTHETIC.pdf'); form.set('documentType', 'diagnosis_certificate'); return form; };
  const rejected = await service.post(`/journeys/${journey.id}/documents`, upload(samplePdf('boarding_pass')), cookie);
  assert.equal(rejected.status, 422); assert.equal((await rejected.json()).error.code, 'SYNTHETIC_DOCUMENT_REQUIRED'); assert.equal(calls, 0);
  const accepted = await service.post(`/journeys/${journey.id}/documents`, upload(samplePdf('diagnosis_certificate')), cookie);
  assert.equal(accepted.status, 200); const added = await accepted.json(); assert.equal(added.journey.readiness, 70); assert.equal(added.document.isMock, false); assert.equal(calls, 1);
});

test('A timed-out regular request returns JSON and does not shut down subsequent real-provider requests', async t => {
  let calls = 0; const demo = createDemoProvider();
  const provider = { mode: 'live', understandIntent: message => ++calls === 1 ? new Promise(() => {}) : demo.understandIntent(message) };
  const service = await api(t, config(), provider);
  const first = await service.post('/intelligence/understand', { message: story });
  assert.equal(first.status, 504); assert.equal((await first.json()).error.code, 'AI_TIMEOUT');
  const cookie = first.headers.get('set-cookie').split(';')[0];
  const second = await service.post('/intelligence/understand', { message: story }, cookie);
  assert.equal(second.status, 200); assert.equal(second.headers.get('X-NAVI-AI-Mode'), 'live'); assert.equal(calls, 2);
});

test('The public long-running process budget resets with the same Pacific day as the durable cap', () => {
  let now = Date.parse('2026-10-25T12:00:00Z');
  const budget = createAIRequestBudget(1, { daily: true, now: () => now }); budget.consume();
  assert.throws(() => budget.consume(), { code: 'AI_REQUEST_BUDGET_REACHED' });
  now += 86400000; budget.consume(); assert.equal(budget.status().used, 1);
  now -= 86400000; assert.throws(() => budget.consume(), { code: 'AI_USAGE_UNAVAILABLE' });
  const manualBudget = createAIRequestBudget(1); manualBudget.consume(); assert.throws(() => manualBudget.consume(), { code: 'AI_REQUEST_BUDGET_REACHED' });
  assert.equal(offlineNetworkStats().externalRequests, 0);
});

test('Public synthetic golden path keeps manual fields unverified and retracts evidence credit', async t => {
  let generations = 0; const demo = createDemoProvider();
  const service = await api(t, { ...config(), syntheticDocumentHashes: ['diagnosis_certificate', 'bank_passbook'].map(kind => fingerprint(samplePdf(kind))) }, { ...demo, mode: 'live', analyzeDocument: upload => { generations++; return demo.analyzeDocument(upload); } });
  const created = await service.post('/journeys', { message: story }); const cookie = created.headers.get('set-cookie').split(';')[0]; let journey = await created.json();
  const manual = await service.post(`/journeys/${journey.id}/manual-document-information`, { documentType: 'diagnosis_certificate', fields: { hospitalName: '合成測試醫院' } }, cookie);
  assert.equal((await manual.json()).journey.readiness, 35);
  for (const [kind, score] of [['diagnosis_certificate', 70], ['bank_passbook', 90]]) {
    const form = new FormData(); form.set('file', new Blob([samplePdf(kind)], { type: 'application/pdf' }), kind + '.pdf'); form.set('documentType', kind);
    const uploaded = await service.post(`/journeys/${journey.id}/documents`, form, cookie); assert.equal(uploaded.status, 200); journey = (await uploaded.json()).journey; assert.equal(journey.readiness, score);
  }
  const reviewed = await service.post(`/journeys/${journey.id}/review`, { confirmed: true }, cookie); journey = await reviewed.json(); assert.equal(journey.readiness, 100);
  const bank = journey.documents.find(document => document.documentType === 'bank_passbook');
  assert.equal('accountNumber' in bank.fields, false);
  const removed = await fetch(service.base + `/journeys/${journey.id}/documents/${bank.id}`, { method: 'DELETE', headers: { Origin: origin, Cookie: cookie } });
  assert.equal((await removed.json()).readiness, 70); assert.equal(generations, 2); assert.equal(offlineNetworkStats().externalRequests, 0);
});
