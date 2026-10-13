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

test('a reload restores the journey from the server; an expired journey is cleared', async t => {
  const storage = memoryStorage();
  const first = client(await backend(t), storage);
  const { snapshot } = await first.analyze(DEMO_STORY);

  // A restarted server (new in-memory repository) no longer has the journey.
  const reloaded = client(await backend(t), storage);
  assert.equal(reloaded.restore().journey.id, snapshot.journey.id);
  await assert.rejects(reloaded.sync(), { code: 'JOURNEY_NOT_FOUND', message: '這份服務旅程已失效或不存在，請重新開始。' });
  assert.equal(storage.getItem('navi.journey'), null);
  assert.equal(client('http://unused', storage).restore(), null);
});

test('only 住院醫療理賠 opens a server journey; outpatient-only and other services stay on the landing page', async t => {
  const service = client(await backend(t));
  for (const story of ['我只有門診開刀，沒有住院，要怎麼申請理賠？', '我想更改保單的繳費方式', '你好']) {
    const result = await service.analyze(story);
    assert.equal(result.snapshot, null, story);
  }
  assert.equal(service.restore(), null);
});

test('server errors reach the user as written; manual entry is off in formal mode', async t => {
  const service = client(await backend(t));
  await service.analyze(DEMO_STORY);
  const text = new File(['hello'], 'note.txt', { type: 'text/plain' });
  await assert.rejects(service.uploadDocument('diagnosis_certificate', { file: text }), error => error.code === 'UNSUPPORTED_FILE_TYPE' && /PDF/.test(error.message));
  assert.equal(service.capabilities.manualEntry, false);
  assert.throws(() => service.submitManual('diagnosis_certificate', {}), { code: 'MANUAL_ENTRY_UNAVAILABLE' });
});
