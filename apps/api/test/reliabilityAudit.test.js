import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createGeminiProvider } from '../src/services/gemini.service.js';
import { createDemoProvider } from '../src/ai/demoProvider.js';
import { createJourneyService } from '../src/services/journeyService.js';
import { InMemoryJourneyRepository } from '../src/repositories/inMemoryJourneyRepository.js';
import { loadConfig } from '../src/config/env.js';
import { understandTasks } from '../src/services/taskService.js';
import { TaskUnderstandingSchema, CorrectJourneyIntentResponseSchema } from '../../../shared/serviceTasks.js';
import { createHandoffConfirmationService } from '../src/services/competitionService.js';
import { startHospitalApi, HOSPITAL_STORY, hospitalConfig } from './hospitalApi.js';
import { samplePdf } from './sampleDocuments.js';
import { result } from './fixtures.js';
import { offlineNetworkStats } from './networkGuard.js';

const config = { ...loadConfig({ AI_MODE: 'live', GEMINI_API_KEY: 'synthetic-only', GEMINI_FREE_TIER_CONFIRMED: 'true', AI_MAX_ATTEMPTS: '1' }), rateLimit: 1000 };
const response = raw => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] }));
const upload = type => { const bytes = samplePdf(type); return { bytes, documentType: type, mimeType: 'application/pdf', filename: 'synthetic.pdf', size: bytes.length }; };
function service(provider = createDemoProvider()) { return createJourneyService({ repository: new InMemoryJourneyRepository(), config: hospitalConfig, provider }); }
async function complete(s) { let j = await s.create({ message: HOSPITAL_STORY }); j = (await s.addDocument(j.id, upload('diagnosis_certificate'))).journey; return (await s.addDocument(j.id, upload('bank_passbook'))).journey; }

test('R01 multiple tasks survive one Gemini transport request without automatically creating journeys', async () => {
  const message = '我想改地址，也想知道要怎麼申請住院理賠。'; let calls = 0;
  const provider = createGeminiProvider(config, async (_url, options) => {
    calls++;
    const request = JSON.parse(options.body); assert.match(request.systemInstruction.parts[0].text, /各保留一項/);
    return response({ tasks: [{ input: '我想改地址', data: result('policy_change') }, { input: '想知道要怎麼申請住院理賠。', data: result('hospitalization_claim') }] });
  });
  const data = TaskUnderstandingSchema.parse(await understandTasks(message, { config, provider }));
  assert.deepEqual(data.tasks.map(t => t.data.serviceType), ['policy_change', 'hospitalization_claim']);
  assert.equal(data.nextStep, 'confirm_one_task'); assert.equal(data.isMock, false); assert.equal(calls, 1);
});

test('R02 invented tasks, business fields and malformed task output fail closed', async () => {
  for (const raw of [{ tasks: [{ input: '我住院了', data: result('hospitalization_claim') }] }, { tasks: [] }, { tasks: [{ input: '我搬家了', data: { ...result('policy_change'), readiness: 100 } }] }]) {
    let calls = 0; const provider = createGeminiProvider(config, async () => { calls++; return response(raw); });
    await assert.rejects(understandTasks('我搬家了', { config, provider }), { code: 'AI_RESPONSE_INVALID' }); assert.equal(calls, 1);
  }
});

test('R03 colloquial move and uncertain hospitalization remain service discovery, not eligibility decisions', async () => {
  const api = await startHospitalApi();
  try {
    for (const [message, expected] of [['我搬家了，幫我處理一下。', 'policy_change'], ['我前幾天住院了，可是我不知道能不能申請理賠。', 'hospitalization_claim']]) {
      const res = await api.request('/intelligence/tasks', { message }); assert.equal(res.status, 200);
      const data = TaskUnderstandingSchema.parse(await res.json()); assert.equal(data.tasks[0].data.serviceType, expected);
      assert.doesNotMatch(data.tasks[0].data.summary, /一定可賠|符合理賠資格|已核准/);
    }
  } finally { await api.close(); }
});

test('R04 outpatient correction invalidates hospital credit and old evidence without deleting independent tasks', async () => {
  const s = service(); const j = await complete(s); s.review(j.id);
  const other = await s.create({ message: '我要改地址' });
  const corrected = CorrectJourneyIntentResponseSchema.parse(await s.correctIntent(j.id, '我其實不是住院，是門診。'));
  assert.equal(corrected.previousServiceType, 'hospitalization_claim'); assert.equal(corrected.journey.serviceType, 'unknown');
  assert.equal(corrected.journey.readiness, 0); assert.equal(corrected.journey.confirmed, false);
  assert.equal(corrected.journey.claimContext, undefined); assert.equal(corrected.journey.officialSources, undefined);
  assert.equal(corrected.journey.sources.length, 0); assert.equal(corrected.journey.documents.length, 2);
  assert.ok(corrected.journey.documents.every(d => d.status === 'needs_review' && !d.matchedRequirements.length));
  assert.deepEqual(s.get(other.id), other);
  assert.throws(() => s.review(j.id), { code: 'SERVICE_NOT_SUPPORTED' });
});

test('R05 late AI result cannot restore hospital credit after correction', async () => {
  const demo = createDemoProvider(); let release;
  const s = service({ ...demo, analyzeDocument: async (...args) => { await new Promise(resolve => { release = resolve; }); return demo.analyzeDocument(...args); } });
  const j = await s.create({ message: HOSPITAL_STORY });
  const work = s.addDocument(j.id, upload('diagnosis_certificate'));
  await s.correctIntent(j.id, '我其實不是住院，是門診。'); release();
  await assert.rejects(work, { code: 'JOURNEY_STALE' });
  assert.equal(s.get(j.id).readiness, 0); assert.equal(s.get(j.id).documents.length, 0);
});

test('R06 bank deletion at 90% revokes exactly 20 points and invalidates handoff; repeated review is idempotent', async () => {
  const s = service(); const j = await complete(s); assert.equal(j.readiness, 90);
  const handoff = createHandoffConfirmationService({ getJourney: s.get }); const preview = handoff.preview(j.id);
  const removed = s.removeDocument(j.id, j.documents.find(d => d.documentType === 'bank_passbook').id);
  assert.equal(removed.readiness, 70); assert.equal(removed.nextAction.target, 'bank_passbook');
  assert.throws(() => handoff.confirm(j.id, { previewId: preview.previewId, confirmed: true }), { code: 'HANDOFF_PREVIEW_STALE' });
  await s.addDocument(j.id, upload('bank_passbook')); const confirmed = s.review(j.id);
  assert.equal(confirmed.readiness, 100); assert.deepEqual(s.review(j.id), confirmed);
});

test('R07 independent parallel documents survive; duplicate analysis cannot overwrite the same slot', async () => {
  const s = service(); const j = await s.create({ message: HOSPITAL_STORY });
  const results = await Promise.all([s.addDocument(j.id, upload('diagnosis_certificate')), s.addDocument(j.id, upload('bank_passbook'))]);
  assert.equal(s.get(j.id).readiness, 90); assert.equal(s.get(j.id).documents.length, 2); assert.equal(results.length, 2);
  const demo = createDemoProvider(); let release;
  const slow = service({ ...demo, analyzeDocument: async (...args) => { await new Promise(r => { release = r; }); return demo.analyzeDocument(...args); } });
  const first = await slow.create({ message: HOSPITAL_STORY }); const pending = slow.addDocument(first.id, upload('diagnosis_certificate'));
  await assert.rejects(slow.addDocument(first.id, upload('diagnosis_certificate')), { code: 'JOURNEY_BUSY' }); release(); await pending;
  assert.equal(slow.get(first.id).documents.length, 1);
});

test('R08 late replacement cannot undo a document deletion made in another tab', async () => {
  const demo = createDemoProvider(); let pause = false; let release;
  const s = service({ ...demo, analyzeDocument: async (...args) => { if (pause) await new Promise(r => { release = r; }); return demo.analyzeDocument(...args); } });
  const j = await complete(s); const doc = j.documents.find(d => d.documentType === 'bank_passbook'); pause = true;
  const pending = s.addDocument(j.id, upload('bank_passbook')); s.removeDocument(j.id, doc.id); release();
  await assert.rejects(pending, { code: 'JOURNEY_STALE' }); assert.equal(s.get(j.id).readiness, 70);
});

test('R09 new repository after service restart expires cases instead of recreating credit', async () => {
  const j = await complete(service()); const restarted = service();
  assert.throws(() => restarted.get(j.id), { code: 'JOURNEY_NOT_FOUND' });
});

test('R10 disconnect aborts pending AI work and cannot commit a document', async () => {
  const demo = createDemoProvider();
  const s = service({ ...demo, analyzeDocument: (_upload, signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  const j = await s.create({ message: HOSPITAL_STORY }); const abort = new AbortController();
  const pending = s.addDocument(j.id, upload('diagnosis_certificate'), abort.signal); abort.abort();
  await assert.rejects(pending, { code: 'REQUEST_CANCELLED' }); assert.equal(s.get(j.id).readiness, 35);
});

test('R11 correction uses the real provider boundary and ignores browser supplied business decisions', async () => {
  let calls = 0;
  const provider = { ...createDemoProvider(), mode: 'live', understandIntent: async message => { calls++; return result(message.includes('不是') ? 'hospitalization_claim' : 'hospitalization_claim'); } };
  const api = await startHospitalApi({ provider });
  try {
    const j = await api.create();
    const bad = await api.request(`/journeys/${j.id}/intent-correction`, { message: '不是住院', readiness: 100 }); assert.equal(bad.status, 400);
    const correction = await api.request(`/journeys/${j.id}/intent-correction`, { message: '我其實不是住院，是門診' });
    assert.equal(correction.headers.get('X-NAVI-AI-Mode'), 'live'); const body = await correction.json(); assert.equal(body.journey.readiness, 0); assert.equal(calls, 2);
  } finally { await api.close(); }
});

test('R12 arbitrary client mode, URL and authority fields cannot bypass task schema', async () => {
  const api = await startHospitalApi();
  try {
    for (const extra of [{ mode: 'live' }, { url: 'javascript:alert(1)' }, { currentStage: 'READY_TO_PROCEED' }]) assert.equal((await api.request('/intelligence/tasks', { message: '我搬家了', ...extra })).status, 400);
  } finally { await api.close(); }
});

test('R13 unavailable AI never creates tasks from demo fixtures', async () => {
  const server = createApp({ ...config, aiMode: 'unavailable' }).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/intelligence/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '我搬家了' }) });
    assert.equal(res.status, 503); assert.equal(res.headers.get('X-NAVI-AI-Mode'), 'unavailable'); assert.equal((await res.json()).error.code, 'AI_UNAVAILABLE');
  } finally { await new Promise(r => server.close(r)); }
});

test('R14 unknown input requires confirmation without opening a hospital workflow', async () => {
  const data = await understandTasks('幫我一下', { provider: createDemoProvider(), config: hospitalConfig });
  assert.equal(data.tasks[0].data.serviceType, 'unknown'); assert.equal(data.tasks[0].outcome, 'clarification');
});

test('R15 hardening regression made no external generation requests', () => { assert.deepEqual(offlineNetworkStats(), { blockedExternalAttempts: 0, externalRequests: 0 }); });

test('New task API and correction enforce production session ownership and preserve the selected server receipt', async t => {
  const origin = 'https://app.navitw.com'; let taskCalls = 0; let intentCalls = 0;
  const c = { ...config, restrictedLive: true, publicSynthetic: true, production: true, origins: [origin], sessionRequestLimit: 6 };
  const provider = { mode: 'live', understandTasks: async input => { taskCalls++; return { tasks: [{ input, data: result('hospitalization_claim') }] }; }, understandIntent: async () => { intentCalls++; return result('unknown'); } };
  const server = createApp(c, provider).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (path, body, cookie, requestOrigin = origin) => fetch(base + path, { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const analysis = await post('/intelligence/tasks', { message: HOSPITAL_STORY }); assert.equal(analysis.status, 200);
  const cookie = analysis.headers.get('set-cookie').split(';')[0]; const tasks = await analysis.json();
  const create = await post('/journeys', { message: tasks.tasks[0].input }, cookie); assert.equal(create.status, 201); const j = await create.json();
  assert.equal(j.readiness, 35); assert.equal(taskCalls, 1); assert.equal(intentCalls, 0);
  for (const [owner, host] of [[undefined, origin], [cookie, 'https://evil.invalid']]) {
    const res = await post(`/journeys/${j.id}/intent-correction`, { message: '我其實不是住院，是門診' }, owner, host); assert.equal(res.status, 403);
  }
  const other = await post('/intelligence/tasks', { message: HOSPITAL_STORY }); const otherCookie = other.headers.get('set-cookie').split(';')[0];
  assert.equal((await post(`/journeys/${j.id}/intent-correction`, { message: '我不是住院' }, otherCookie)).status, 404);
  const correction = await post(`/journeys/${j.id}/intent-correction`, { message: '我其實不是住院，是門診' }, cookie);
  assert.equal(correction.status, 200); assert.equal((await correction.json()).journey.readiness, 0); assert.equal(intentCalls, 1);
});

test('Unclassified and declared uploads cannot race to overwrite the same actual document type', async () => {
  const demo = createDemoProvider(); let release;
  const s = service({ ...demo, analyzeDocument: async upload => {
    if (!upload.documentType) await new Promise(r => { release = r; });
    return demo.analyzeDocument({ documentType: 'diagnosis_certificate' });
  } });
  const j = await s.create({ message: HOSPITAL_STORY }); const unclassified = upload('diagnosis_certificate'); delete unclassified.documentType;
  const pending = s.addDocument(j.id, unclassified);
  const saved = await s.addDocument(j.id, upload('diagnosis_certificate')); release();
  await assert.rejects(pending, { code: 'JOURNEY_STALE' }); assert.equal(s.get(j.id).documents[0].id, saved.document.id);
});


test('Partial multi-intent extraction cannot silently discard the remaining request', async () => {
  const provider = createGeminiProvider(config, async () => response({ tasks: [{ input: '我想改地址', data: result('policy_change') }] }));
  await assert.rejects(understandTasks('我想改地址，也想知道要怎麼申請住院理賠。', { config, provider }), { code: 'AI_RESPONSE_INVALID' });
});
