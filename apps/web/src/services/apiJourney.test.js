import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiJourneyService } from './apiJourney.js';
import { understandIntent } from './intelligence.js';
import { DEMO_STORY } from '../mocks/hospitalClaim.js';
// Formal mode talks to the real backend; run it in-process with the scripted demo provider (no AI calls).
import { createApp } from '../../../api/src/app.js';
import { loadConfig } from '../../../api/src/config/env.js';
import { createDemoProvider } from '../../../api/src/ai/demoProvider.js';

const config = { ...loadConfig({ AI_MODE: 'demo' }), rateLimit: 1000 };

async function backend(t) {
  const http = createApp(config, createDemoProvider()).listen(0, '127.0.0.1');
  await new Promise(resolve => http.once('listening', resolve));
  t.after(() => new Promise(resolve => http.close(resolve)));
  return `http://127.0.0.1:${http.address().port}`;
}
function memoryStorage() {
  const map = new Map();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
}
const client = (baseUrl, storage = memoryStorage()) => createApiJourneyService({
  baseUrl, storage, understand: (message, { signal } = {}) => understandIntent(message, { signal, baseUrl }),
});

test('formal mode renders the server-owned 住院 journey: 35 → 70 → 90 → 100, and removal withdraws', async t => {
  const service = client(await backend(t));
  const { snapshot } = await service.analyze(DEMO_STORY);
  assert.equal(snapshot.context.kind, 'hospital');
  assert.equal(snapshot.journey.readiness, 35);
  assert.equal(snapshot.journey.currentStage, 'EVIDENCE_COLLECTION');
  assert.equal(snapshot.journey.claimContext.hospital.matchedName, '臺中榮民總醫院');
  assert.equal(snapshot.journey.nextAction.target, 'diagnosis_certificate');

  const certificate = await service.uploadDocument('diagnosis_certificate', { sample: true });
  assert.equal(certificate.journey.readiness, 70);
  const document = certificate.journey.documents[0];
  assert.equal(document.isMock, true, 'demo provider fixtures are labelled as mock');
  assert.equal(document.fields.diagnosis, null, 'clinical details are not extracted');

  assert.equal((await service.uploadDocument('bank_passbook', { sample: true })).journey.currentStage, 'READY_FOR_REVIEW');
  const done = await service.confirm();
  assert.equal(done.journey.readiness, 100);
  assert.equal(done.journey.currentStage, 'READY_TO_PROCEED');
  assert.equal(done.journey.nextAction.target, 'hospital_upload');

  const removed = await service.removeDocument('bank_passbook');
  assert.equal(removed.journey.readiness, 70);
  assert.equal(removed.journey.confirmed, false);
});

test('a reload reads the journey back from the server; an expired journey is cleared', async t => {
  const storage = memoryStorage();
  const baseUrl = await backend(t);
  const first = client(baseUrl, storage);
  const { snapshot } = await first.analyze(DEMO_STORY);
  await first.uploadDocument('diagnosis_certificate', { sample: true });

  const reloaded = client(baseUrl, storage);
  assert.equal(reloaded.restore(), null, 'nothing is rendered from the browser copy');
  const resumed = await reloaded.resume();
  assert.equal(resumed.journey.id, snapshot.journey.id);
  assert.equal(resumed.journey.readiness, 70);

  // A restarted server (new in-memory repository) no longer has the journey.
  const restarted = client(await backend(t), storage);
  restarted.restore();
  await assert.rejects(restarted.resume(), { code: 'JOURNEY_NOT_FOUND', message: '這份服務旅程已失效或不存在，請重新開始。' });
  assert.equal(storage.getItem('navi.journey'), null);
});

test('the browser keeps only the journey id; the description is masked and never stored', async t => {
  const storage = memoryStorage();
  const baseUrl = await backend(t);
  const service = client(baseUrl, storage);
  const story = '我上週在台中榮總住院五天，我的電話 0912-345-678，身分證 A123456789，要怎麼申請理賠？';
  const { snapshot } = await service.analyze(story);
  await service.uploadDocument('diagnosis_certificate', { sample: true });

  const stored = storage.getItem('navi.journey');
  assert.deepEqual(Object.keys(JSON.parse(stored)).sort(), ['handoffRequested', 'journeyId', 'source', 'v']);
  for (const secret of ['0912', 'A123456789', '台中榮總', 'NAVI SYNTHETIC PATIENT']) assert.ok(!stored.includes(secret), secret);
  assert.doesNotMatch(snapshot.context.story, /0912|A123456789/);
  assert.match(snapshot.context.story, /台中榮總住院五天/);
  // After a reload only the server's neutral note is available.
  const reloaded = client(baseUrl, storage);
  reloaded.restore();
  assert.doesNotMatch((await reloaded.resume()).context.story, /台中榮總|0912/);

  // A stored copy from the previous format (which held the raw description) is discarded.
  const legacy = memoryStorage();
  legacy.setItem('navi.journey', JSON.stringify({ v: 1, story, journey: snapshot.journey, source: 'demo_fallback', handoffRequested: false }));
  assert.equal(client('http://unused', legacy).restore(), null);
  assert.equal(legacy.getItem('navi.journey'), null);
});

test('only 住院醫療理賠 opens a server journey; outpatient-only and other services stay on the landing page', async t => {
  const service = client(await backend(t));
  for (const story of ['我只有門診開刀，沒有住院，要怎麼申請理賠？', '我想更改保單的繳費方式', '你好']) {
    const result = await service.analyze(story);
    assert.equal(result.snapshot, null, story);
  }
  assert.equal(service.restore(), null);
});

test('a 住院 information question (knowledge_query) never creates a journey', async t => {
  const baseUrl = await backend(t);
  const question = { success: true, data: { intent: 'knowledge_query', serviceType: 'hospitalization_claim', confidence: 0.9, summary: '詢問住院理賠文件', extractedData: { origin: null, destination: null, delayMinutes: null, incidentDate: null } }, meta: { source: 'gemini', confidenceThreshold: 0.65, outcome: 'preview' } };
  const service = createApiJourneyService({ baseUrl, storage: memoryStorage(), understand: async () => question });
  const result = await service.analyze('住院要準備什麼文件');
  assert.equal(result.snapshot, null);
  assert.equal(result.kind, 'hospital');
});

test('server errors reach the user as written', async t => {
  const service = client(await backend(t));
  await service.analyze(DEMO_STORY);
  const text = new File(['hello'], 'note.txt', { type: 'text/plain' });
  await assert.rejects(service.uploadDocument('diagnosis_certificate', { file: text }), error => error.code === 'UNSUPPORTED_FILE_TYPE' && /PDF/.test(error.message));
  await assert.rejects(service.submitManual('bank_passbook', { bankName: null, accountLast4: null }), { code: 'INVALID_INPUT' });
});

test('formal-mode manual information is stored as 待確認: no readiness, no document, no review; a verified upload replaces it', async t => {
  const service = client(await backend(t));
  assert.deepEqual(service.capabilities, { manualEntry: false, manualInformation: true });
  await service.analyze(DEMO_STORY);
  const typed = await service.submitManual('diagnosis_certificate', { hospitalName: '臺中榮民總醫院', admissionDate: '2026-10-01', dischargeDate: '2026-10-05', reportedInpatientDays: 5 });
  assert.equal(typed.journey.readiness, 35, 'manual information adds no readiness');
  assert.equal(typed.journey.documents.length, 0, 'it is not a document');
  assert.deepEqual(typed.journey.manualDocumentInformation.map(m => [m.documentType, m.source, m.status]), [['diagnosis_certificate', 'manual', 'needs_review']]);
  await service.submitManual('bank_passbook', { bankName: '示範銀行', accountLast4: '1234' });
  await assert.rejects(service.confirm(), { status: 409 }, 'manual information cannot unlock review');

  const removed = await service.removeManual('bank_passbook');
  assert.deepEqual(removed.journey.manualDocumentInformation.map(m => m.documentType), ['diagnosis_certificate']);
  const uploaded = await service.uploadDocument('diagnosis_certificate', { sample: true });
  assert.equal(uploaded.journey.readiness, 70);
  assert.ok(!(uploaded.journey.manualDocumentInformation ?? []).some(m => m.documentType === 'diagnosis_certificate'), 'the verified upload clears the typed information');
});
