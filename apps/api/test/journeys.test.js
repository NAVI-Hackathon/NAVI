import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDemoProvider } from '../src/ai/demoProvider.js';
import { InMemoryJourneyRepository } from '../src/repositories/inMemoryJourneyRepository.js';
import { ServiceJourneySchema, MAX_DOCUMENT_BYTES } from '../../../shared/journey.js';
import { UnderstandingSchema } from '../../../shared/intelligence.js';
import { calculateDelayMinutes } from '../src/services/documentService.js';
import { withProviderDeadline } from '../src/services/providerRequest.js';
import { result, inputs } from './fixtures.js';

const message = '我昨天從東京回台灣，班機延誤了 7 小時，不知道可以申請什麼。';
const pdf = Buffer.from('%PDF-1.4\nNAVI demo fixture\n%%EOF');
async function server(t, provider = createDemoProvider()) {
  const http = createApp({ ...loadConfig({ AI_MODE: 'demo' }), rateLimit: 300 }, provider).listen(0, '127.0.0.1');
  await new Promise(resolve => http.once('listening', resolve));
  t.after(() => new Promise(resolve => http.close(resolve)));
  const url = `http://127.0.0.1:${http.address().port}`;
  return {
    request: (path, options = {}) => fetch(url + '/api' + path, options),
    post: (path, body) => fetch(url + '/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    async create(intentResult) { const response = await this.post('/journeys', { message, ...(intentResult ? { intentResult } : {}) }); assert.equal(response.status, 201); return ServiceJourneySchema.parse(await response.json()); },
    upload(id, documentType, bytes = pdf, mime = 'application/pdf') {
      const form = new FormData();
      form.set('file', new Blob([bytes], { type: mime }), 'sample.pdf');
      if (documentType !== undefined) form.set('documentType', documentType);
      return this.request(`/journeys/${id}/documents`, { method: 'POST', body: form });
    },
  };
}

test('Demo Provider recognizes Chinese/English and secondary intents, preserves unknown', async t => {
  const api = await server(t);
  for (const [input, serviceType] of inputs) {
    const response = await api.post('/analyze-intent', { message: input });
    assert.equal(response.status, 200); assert.equal(response.headers.get('x-navi-ai-mode'), 'demo');
    const data = await response.json(); assert.equal(data.serviceType, serviceType);
    if (serviceType === 'flight_delay') assert.equal(data.extractedData.delayMinutes, 420);
  }
  const old = await api.post('/intelligence/understand', { message });
  assert.equal(UnderstandingSchema.parse(await old.json()).meta.source, 'demo_fallback');
  const ambiguity = await api.post('/analyze-intent', { message: '班機延誤，也剛發生車禍' });
  assert.equal((await ambiguity.json()).serviceType, 'unknown');
});

test('full server Golden Path 35→70→90→100 with next action, state and sources', async t => {
  const api = await server(t);
  const initial = await api.create();
  assert.equal(initial.readiness, 35); assert.equal(initial.currentStage, 'EVIDENCE_COLLECTION');
  assert.equal(initial.provider, 'demo'); assert.equal(initial.nextAction.target, 'boarding_pass');
  assert.equal(initial.requirements.reduce((sum, r) => sum + r.weight, 0), 100);
  assert.ok(initial.sources.every(source => source.isMock && source.url === null));
  assert.equal((await api.post(`/journeys/${initial.id}/review`, { confirmed: true })).status, 409);
  const boarding = await (await api.upload(initial.id, 'boarding_pass')).json();
  assert.equal(boarding.journey.readiness, 70); assert.deepEqual(boarding.readinessChange, { before: 35, after: 70 });
  assert.equal(boarding.document.status, 'verified'); assert.equal(boarding.document.isMock, true);
  assert.equal(boarding.journey.nextAction.target, 'delay_certificate');
  const delay = await (await api.upload(initial.id, 'delay_certificate')).json();
  assert.equal(delay.document.fields.delayMinutes, 443); assert.equal(delay.journey.readiness, 90);
  assert.equal(delay.journey.currentStage, 'READY_FOR_REVIEW'); assert.equal(delay.journey.nextAction.type, 'REVIEW_INFORMATION');
  const reviewed = ServiceJourneySchema.parse(await (await api.post(`/journeys/${initial.id}/review`, { confirmed: true })).json());
  assert.equal(reviewed.readiness, 100); assert.equal(reviewed.currentStage, 'READY_TO_PROCEED'); assert.equal(reviewed.nextAction.type, 'PROCEED_TO_SERVICE');
  assert.deepEqual(await (await api.request(`/journeys/${initial.id}`)).json(), reviewed);
  const summary = await (await api.request(`/journeys/${initial.id}/handoff-summary`)).json();
  assert.equal(summary.issue, '班機延誤'); assert.deepEqual(summary.missing, []); assert.ok(summary.collected.includes('登機證'));
});

test('remove/re-upload/replacement revokes confirmation without losing other evidence', async t => {
  const api = await server(t); const journey = await api.create();
  const boarding = await (await api.upload(journey.id, 'boarding_pass')).json();
  await api.upload(journey.id, 'delay_certificate');
  await api.post(`/journeys/${journey.id}/review`, { confirmed: true });
  const removed = await (await api.request(`/journeys/${journey.id}/documents/${boarding.document.id}`, { method: 'DELETE' })).json();
  assert.equal(removed.readiness, 55); assert.equal(removed.confirmed, false);
  const restored = await (await api.upload(journey.id, 'boarding_pass')).json();
  assert.equal(restored.journey.readiness, 90); assert.equal(restored.journey.documents.length, 2);
  await api.post(`/journeys/${journey.id}/review`, { confirmed: true });
  const replaced = await (await api.upload(journey.id, 'delay_certificate')).json();
  assert.equal(replaced.journey.readiness, 90); assert.equal(replaced.journey.documents.length, 2); assert.equal(replaced.journey.confirmed, false);
});

test('confidence thresholds, unknown and unsupported services cannot enter a fake journey', async t => {
  const api = await server(t);
  for (const [confidence, state, action] of [[0.54, 'HUMAN_REVIEW', 'CONTACT_SPECIALIST'], [0.55, 'SERVICE_IDENTIFIED', 'CONTACT_SPECIALIST'], [0.749, 'SERVICE_IDENTIFIED', 'CONTACT_SPECIALIST'], [0.75, 'EVIDENCE_COLLECTION', 'UPLOAD_DOCUMENT']]) {
    const journey = await api.create(result('flight_delay', { confidence }));
    assert.equal(journey.currentStage, state); assert.equal(journey.nextAction.type, action);
    if (confidence < 0.75) assert.equal((await api.upload(journey.id, 'boarding_pass')).status, 409);
  }
  const unknown = await api.create(result('unknown'));
  assert.equal(unknown.readiness, 0); assert.equal(unknown.nextAction.type, 'PROVIDE_INFORMATION');
  const preview = await api.create(result('vehicle_accident'));
  assert.equal(preview.supported, false); assert.equal(preview.readiness, 0); assert.equal(preview.nextAction.type, 'NONE');
  assert.equal((await api.upload(preview.id, 'boarding_pass')).status, 409);
});

test('hospitalization creates a supported server-owned journey instead of a server error', async t => {
  const api = await server(t);
  const response = await api.post('/journeys', { message: '我上週在台中榮總住院五天，要怎麼申請理賠？' });
  assert.equal(response.status, 201);
  const journey = ServiceJourneySchema.parse(await response.json());
  assert.equal(journey.serviceType, 'hospitalization_claim');
  assert.equal(journey.title, '住院醫療理賠');
  assert.equal(journey.supported, true);
  assert.equal(journey.readiness, 35);
  assert.equal(journey.currentStage, 'EVIDENCE_COLLECTION');
  assert.equal(journey.nextAction.target, 'diagnosis_certificate');
  assert.equal(journey.requirements.filter(r => r.required).length, 6);
  assert.deepEqual(journey.documents, []);
  assert.deepEqual(await (await api.request(`/journeys/${journey.id}`)).json(), journey);
  assert.equal((await api.upload(journey.id, 'boarding_pass')).status, 422);
  assert.equal((await api.post(`/journeys/${journey.id}/review`, { confirmed: true })).status, 409);
});

test('medical questions cannot retrieve flight requirements or invoke AI without matching knowledge', async t => {
  let calls = 0;
  const api = await server(t, { ...createDemoProvider(), answerKnowledge: async () => { calls++; throw new Error('Unrelated knowledge must not call AI.'); } });
  for (const question of ['火星醫院專屬方案有哪些？', 'What documents do I need for an invented medical plan?', '住院醫療是否一定核准？', '信用卡年費多少？']) {
    const retrieval = await api.request(`/knowledge?query=${encodeURIComponent(question)}`);
    assert.equal(retrieval.status, 200);
    const knowledge = await retrieval.json();
    assert.equal(knowledge.found, false);
    assert.deepEqual(knowledge.sources, []);
    const response = await api.post('/knowledge/answer', { question });
    assert.equal(response.status, 200);
    const answer = await response.json();
    assert.equal(answer.answer, '目前提供的資料不足以確認。');
    assert.equal(answer.supported, false);
    assert.equal(answer.answerMode, 'insufficient_information');
    assert.deepEqual(answer.sources, []);
  }
  assert.equal(calls, 0);
});

test('unknown documents and malformed provider output fail safely and leave state unchanged', async t => {
  const api = await server(t); const journey = await api.create();
  for (const type of [undefined, 'receipt']) {
    const response = await api.upload(journey.id, type);
    assert.equal(response.status, 422); const error = (await response.json()).error;
    assert.equal(error.code, 'DOCUMENT_UNRECOGNIZED'); assert.equal(error.retryable, true);
  }
  assert.equal((await (await api.request(`/journeys/${journey.id}`)).json()).readiness, 35);
  let calls = 0;
  const invalid = await server(t, { ...createDemoProvider(), analyzeDocument: async () => { calls++; return { documentType: 'boarding_pass', confidence: 'bad', readiness: 100 }; } });
  const invalidJourney = await invalid.create();
  const failed = await invalid.upload(invalidJourney.id, 'boarding_pass');
  assert.equal(failed.status, 502); assert.equal((await failed.json()).error.code, 'AI_RESPONSE_INVALID'); assert.equal(calls, 2);
  const badIntent = await server(t, { understandIntent: async () => ({ serviceType: 'flight_delay', currentStage: 'READY_TO_PROCEED' }) });
  assert.equal((await badIntent.post('/journeys', { message })).status, 502);
});

test('multipart boundaries, MIME/signature/size and strict JSON validation', async t => {
  const api = await server(t); const journey = await api.create();
  for (const body of [{}, { message: '' }, { message: 123 }, { message, readiness: 100 }, { message, intentResult: { ...result(), currentStage: 'READY_TO_PROCEED' } }]) assert.equal((await api.post('/journeys', body)).status, 400);
  assert.equal((await api.post(`/journeys/${journey.id}/documents`, { documentType: 'boarding_pass' })).status, 400);
  const malformed = await api.request(`/journeys/${journey.id}/documents`, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=missing' }, body: 'broken' });
  assert.equal(malformed.status, 400);
  for (const [bytes, mime, status] of [[Buffer.alloc(0), 'application/pdf', 400], [pdf, 'text/plain', 415], [Buffer.from('fake image'), 'image/png', 415], [Buffer.alloc(MAX_DOCUMENT_BYTES + 1), 'application/pdf', 413]]) assert.equal((await api.upload(journey.id, 'boarding_pass', bytes, mime)).status, status);
  const tooLarge = await api.request(`/journeys/${journey.id}/documents`, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body: Buffer.alloc(MAX_DOCUMENT_BYTES + 65537) });
  assert.equal(tooLarge.status, 413);
  assert.equal((await api.post(`/journeys/${journey.id}/review`, { confirmed: false })).status, 400);
  assert.equal((await api.request('/journeys/missing')).status, 404);
});

test('duration uses timestamps, contradictory flight evidence and low confidence need review', async t => {
  assert.equal(calculateDelayMinutes({ scheduledDeparture: '2026-10-05T23:00:00+09:00', actualDeparture: '2026-10-06T06:23:00+09:00' }), 443);
  assert.equal(calculateDelayMinutes({ scheduledDeparture: '2026-10-05T23:00:00+09:00', actualDeparture: '2026-10-05T20:00:00+09:00' }), null);
  const demo = createDemoProvider();
  let boardingUploads = 0;
  const api = await server(t, { ...demo, analyzeDocument: async (upload, signal) => {
    const data = await demo.analyzeDocument(upload, signal);
    if (data.documentType === 'boarding_pass' && ++boardingUploads > 1) data.fields.flightNumber = 'BR999';
    if (data.documentType === 'delay_certificate') { data.fields.flightNumber = 'BR999'; data.fields.delayMinutes = 999; }
    return data;
  } });
  const journey = await api.create(); await api.upload(journey.id, 'boarding_pass');
  const mismatch = await (await api.upload(journey.id, 'delay_certificate')).json();
  assert.equal(mismatch.document.fields.delayMinutes, 443); assert.equal(mismatch.document.status, 'needs_review'); assert.deepEqual(mismatch.document.matchedRequirements, []);
  assert.equal(mismatch.journey.readiness, 70); assert.equal(mismatch.journey.currentStage, 'HUMAN_REVIEW'); assert.equal(mismatch.journey.nextAction.type, 'CONTACT_SPECIALIST');
  const corrected = await (await api.upload(journey.id, 'boarding_pass')).json();
  assert.equal(corrected.journey.readiness, 90); assert.equal(corrected.journey.currentStage, 'READY_FOR_REVIEW');
  const recovered = await (await api.request(`/journeys/${journey.id}/documents/${mismatch.document.id}`, { method: 'DELETE' })).json();
  assert.equal(recovered.currentStage, 'EVIDENCE_COLLECTION'); assert.equal(recovered.nextAction.target, 'delay_certificate');
  const low = await server(t, { ...demo, analyzeDocument: async (upload, signal) => ({ ...await demo.analyzeDocument(upload, signal), confidence: 0.3 }) });
  const lowJourney = await low.create(); const evidence = await (await low.upload(lowJourney.id, 'boarding_pass')).json();
  assert.equal(evidence.journey.readiness, 35); assert.equal(evidence.journey.currentStage, 'HUMAN_REVIEW');
});

test('provider deadlines cover non-cooperative implementations and cancellation', async () => {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(withProviderDeadline(() => new Promise(() => {}), { config: { timeoutMs: 20 }, signal: new AbortController().signal }), { code: 'AI_TIMEOUT' });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(withProviderDeadline(() => assert.fail('provider must not run'), { config: { timeoutMs: 1000 }, signal: controller.signal }), { code: 'REQUEST_CANCELLED' });
  } finally { clearInterval(keepAlive); }
});

test('simultaneous uploads keep both documents; memory repository isolates returned values and expires', async t => {
  const api = await server(t); const journey = await api.create();
  const responses = await Promise.all([api.upload(journey.id, 'boarding_pass'), api.upload(journey.id, 'delay_certificate')]);
  assert.ok(responses.every(response => response.ok));
  const final = await (await api.request(`/journeys/${journey.id}`)).json(); assert.equal(final.readiness, 90); assert.equal(final.documents.length, 2);
  const repository = new InMemoryJourneyRepository({ maxEntries: 1 }); repository.save(journey);
  const copy = repository.get(journey.id); copy.readiness = 100; assert.equal(repository.get(journey.id).readiness, 35);
  assert.throws(() => repository.save({ ...journey, id: 'another' }), { code: 'JOURNEY_CAPACITY_REACHED' });
  const expired = new InMemoryJourneyRepository({ ttlMs: 0 }); expired.save(journey); assert.equal(expired.get(journey.id), null);
});

test('knowledge retrieval stays explicitly prototype, unknown has no invented sources, identifiers are masked', async t => {
  const api = await server(t);
  const knowledge = await (await api.request('/knowledge?query=' + encodeURIComponent('為什麼需要延誤證明？'))).json();
  assert.equal(knowledge.found, true); assert.ok(knowledge.sources.every(s => s.isMock && s.type.startsWith('prototype_')));
  const unknown = await (await api.request('/knowledge?query=' + encodeURIComponent('信用卡年費多少'))).json(); assert.equal(unknown.found, false); assert.deepEqual(unknown.sources, []);
  const response = await api.post('/journeys', { message: message + ' A123456789 0912-345-678 test@example.com' });
  const journey = await response.json(); assert.ok(!JSON.stringify(journey).includes('A123456789')); assert.ok(!JSON.stringify(journey).includes('0912-345-678')); assert.ok(!JSON.stringify(journey).includes('test@example.com'));
});

test('live does not silently mock document intelligence; config only allows explicit modes', async t => {
  assert.equal(loadConfig({}).aiMode, 'demo'); assert.equal(loadConfig({ AI_MODE: 'demo' }).aiMode, 'demo');
  assert.throws(() => loadConfig({ AI_MODE: 'invalid' }));
  const api = await server(t, { mode: 'live', understandIntent: async () => result() });
  const journey = await api.create(); const response = await api.upload(journey.id, 'boarding_pass');
  assert.equal(response.status, 501); const error = (await response.json()).error; assert.equal(error.code, 'DOCUMENT_INTELLIGENCE_NOT_AVAILABLE'); assert.equal(error.retryable, false);
});
