import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiJourneyService } from '../../web/src/services/apiJourney.js';
import { understandIntent } from '../../web/src/services/intelligence.js';
import { startHospitalApi, HOSPITAL_STORY } from './hospitalApi.js';
import { createDemoProvider } from '../src/ai/demoProvider.js';
import { InMemoryJourneyRepository } from '../src/repositories/inMemoryJourneyRepository.js';
import { calculateStay } from '../../../shared/hospitalization.js';
import { DocumentAnalysisSchema, MAX_DOCUMENT_BYTES } from '../../../shared/journey.js';
import { normalizeGeminiDocument, documentJsonSchema } from '../src/ai/schemas.js';
import { syntheticImages } from './syntheticImages.js';
import { samplePdf } from './sampleDocuments.js';
import { loadHospitalDataset, evaluateHospitalization } from '../eval/hospitalization/runner.js';

async function apiFor(t, options) { const api = await startHospitalApi(options); t.after(() => api.close()); return api; }
async function json(response, status = 200) { assert.equal(response.status, status); return response.json(); }

test('calendar stay periods preserve date/printed provenance and never become benefit-day decisions', () => {
  for (const [fields, days, source] of [
    [{ admissionDate: '2026-10-01', dischargeDate: '2026-10-01' }, 1, 'dates'],
    [{ admissionDate: '2026-09-29', dischargeDate: '2026-10-02' }, 4, 'dates'],
    [{ admissionDate: '2025-12-30', dischargeDate: '2026-01-02' }, 4, 'dates'],
    [{ admissionDate: '2024-02-28', dischargeDate: '2024-03-01' }, 3, 'dates'],
    [{ admissionDate: '2026-02-29', dischargeDate: '2026-03-01' }, null, null],
    [{ admissionDate: '2026-10-06', dischargeDate: '2026-10-01' }, null, null],
    [{ admissionDate: '2026-10-01' }, null, null], [{ dischargeDate: '2026-10-05' }, null, null],
    [{ reportedInpatientDays: 5 }, 5, 'printed_days'],
  ]) assert.deepEqual(calculateStay(fields), { days, source });
});

test('hospitalization certificate spelling normalizes to the existing proof enum; native/public schemas remain compatible', () => {
  const fields = { passengerName: null, flightNumber: null, origin: null, destination: null, departureDate: null, actualDepartureDate: null, scheduledDeparture: null, actualDeparture: null, hospitalName: 'NAVI SYNTHETIC HOSPITAL', patientName: 'NAVI SYNTHETIC PATIENT', admissionDate: null, dischargeDate: null, reportedInpatientDays: 5, certificateKind: 'hospitalization_certificate' };
  const output = normalizeGeminiDocument({ documentType: 'diagnosis_certificate', confidence: .97, fields });
  assert.equal(output.fields.certificateKind, 'hospitalization_proof');
  DocumentAnalysisSchema.parse(output);
  assert.deepEqual(documentJsonSchema.properties.fields.properties.certificateKind.anyOf[0].enum, ['diagnosis_certificate', 'hospitalization_proof']);
});

test('multipart accepts real synthetic PDF/PNG/JPEG/WebP containers and keeps all Demo outcomes labeled Mock', async t => {
  const api = await apiFor(t); const journey = await api.create();
  for (const [mime, bytes] of [['application/pdf', samplePdf('diagnosis_certificate')], ...Object.entries(syntheticImages).map(([mime, data]) => [mime, Buffer.from(data, 'base64')])]) {
    const result = await json(await api.upload(journey.id, 'diagnosis_certificate', { mime, bytes, filename: '../SYNTHETIC-SECRET-00000000001234.pdf' }));
    assert.equal(result.document.isMock, true); assert.equal(result.document.source, 'demo');
    assert.equal(result.journey.readiness, 70); assert.equal(result.journey.documents.length, 1);
    assert.doesNotMatch(result.document.filename, /SECRET|1234|\.\./);
  }
});

test('multipart malformed, empty, oversized, mismatched, truncated and duplicate files fail before provider invocation', async t => {
  let calls = 0; const demo = createDemoProvider();
  const api = await apiFor(t, { provider: { ...demo, analyzeDocument: (...args) => { calls++; return demo.analyzeDocument(...args); } } });
  const journey = await api.create();
  const cases = [
    [{ bytes: Buffer.alloc(0) }, 400, 'EMPTY_DOCUMENT'],
    [{ mime: 'text/plain' }, 415, 'UNSUPPORTED_FILE_TYPE'],
    [{ mime: 'image/png', bytes: samplePdf('diagnosis_certificate') }, 415, 'UNSUPPORTED_FILE_TYPE'],
    [{ bytes: Buffer.from('%PDF-1.4\ntruncated') }, 422, 'DOCUMENT_INVALID'],
    [{ mime: 'image/png', bytes: Buffer.from(syntheticImages['image/png'], 'base64').subarray(0, 24) }, 422, 'DOCUMENT_INVALID'],
    [{ mime: 'image/jpeg', bytes: Buffer.from(syntheticImages['image/jpeg'], 'base64').subarray(0, -2) }, 422, 'DOCUMENT_INVALID'],
    [{ mime: 'image/webp', bytes: Buffer.from(syntheticImages['image/webp'], 'base64').subarray(0, -2) }, 422, 'DOCUMENT_INVALID'],
    [{ bytes: Buffer.alloc(MAX_DOCUMENT_BYTES + 1) }, 413, 'DOCUMENT_TOO_LARGE'],
    [{ duplicate: true }, 400, 'INVALID_INPUT'],
  ];
  for (const [options, status, code] of cases) assert.equal((await json(await api.upload(journey.id, 'diagnosis_certificate', options), status)).error.code, code);
  assert.equal((await json(await api.upload(journey.id, 'not_a_document'), 422)).error.code, 'DOCUMENT_UNRECOGNIZED');
  const form = new FormData(); form.set('file', new Blob([samplePdf('diagnosis_certificate')], { type: 'application/pdf' }), 'synthetic.pdf'); form.append('documentType', 'diagnosis_certificate'); form.append('documentType', 'bank_passbook');
  assert.equal((await api.request(`/journeys/${journey.id}/documents`, form)).status, 400);
  assert.equal(calls, 0); assert.equal((await json(await api.request(`/journeys/${journey.id}`))).readiness, 35);
});

test('unknown extracted documents and service-mismatched evidence leave the stored journey unchanged', async t => {
  const demo = createDemoProvider();
  const api = await apiFor(t, { provider: { ...demo, analyzeDocument: async () => ({ documentType: 'unknown', confidence: .2, fields: {} }) } });
  const journey = await api.create();
  assert.equal((await json(await api.upload(journey.id, 'diagnosis_certificate'), 422)).error.code, 'DOCUMENT_UNRECOGNIZED');
  assert.equal((await json(await api.request(`/journeys/${journey.id}`))).documents.length, 0);
  const normal = await apiFor(t); const hospital = await normal.create();
  assert.equal((await json(await normal.upload(hospital.id, 'boarding_pass'), 422)).error.code, 'DOCUMENT_SERVICE_MISMATCH');
});

test('low confidence and corrected evidence go through human review without a rejection or duplicated score', async t => {
  let confidence = .3, holder = 'NAVI OTHER SYNTHETIC PATIENT'; const demo = createDemoProvider();
  const api = await apiFor(t, { provider: { ...demo, async analyzeDocument(upload) {
    const result = await demo.analyzeDocument(upload);
    if (upload.documentType === 'diagnosis_certificate') result.confidence = confidence;
    else result.fields.accountHolder = holder;
    return result;
  } } });
  const journey = await api.create();
  let result = await json(await api.upload(journey.id, 'diagnosis_certificate'));
  assert.equal(result.document.status, 'needs_review'); assert.equal(result.journey.readiness, 35); assert.equal(result.journey.currentStage, 'HUMAN_REVIEW');
  confidence = .97; await api.upload(journey.id, 'diagnosis_certificate');
  result = await json(await api.upload(journey.id, 'bank_passbook'));
  assert.equal(result.journey.readiness, 70); assert.equal(result.journey.nextAction.type, 'CONTACT_SPECIALIST');
  holder = 'NAVI SYNTHETIC PATIENT';
  result = await json(await api.upload(journey.id, 'bank_passbook'));
  assert.equal(result.journey.readiness, 90); assert.equal(result.journey.documents.length, 2); assert.deepEqual(result.journey.consistencyIssues, []);
  const summary = await json(await api.request(`/journeys/${journey.id}/handoff-summary`));
  assert.ok(!JSON.stringify(summary).includes(holder));
});

test('a journey expiring during document analysis cannot be resurrected or consume another upload afterward', { timeout: 2000 }, async t => {
  const repository = new InMemoryJourneyRepository(); const demo = createDemoProvider();
  let start, finish, calls = 0; const started = new Promise(resolve => { start = resolve; }); const gate = new Promise(resolve => { finish = resolve; });
  const api = await apiFor(t, { repository, provider: { ...demo, async analyzeDocument(upload) { calls++; start(); await gate; return demo.analyzeDocument(upload); } } });
  const journey = await api.create(); const pending = api.upload(journey.id, 'diagnosis_certificate');
  await started; repository.entries.get(journey.id).expiresAt = Date.now() - 1; finish();
  assert.equal((await json(await pending, 404)).error.code, 'JOURNEY_NOT_FOUND');
  assert.equal(repository.get(journey.id), null);
  assert.equal((await api.upload(journey.id, 'bank_passbook')).status, 404); assert.equal(calls, 1);
});

test('structured medical names cannot leak accidental identifiers through documents, errors, logs or repository', async t => {
  const secret = '00000000001234'; const clinical = 'NAVI_SYNTHETIC_CLINICAL_DETAIL'; const demo = createDemoProvider();
  const repository = new InMemoryJourneyRepository(); const logs = []; const warn = console.warn;
  console.warn = (...args) => logs.push(args.join(' ')); t.after(() => { console.warn = warn; });
  const api = await apiFor(t, { repository, provider: { ...demo, understandIntent: async message => { const data = await demo.understandIntent(message); return { ...data, summary: clinical + ' 已核准理賠，確定給付五天。', extractedData: { ...data.extractedData, patientName: secret } }; }, async analyzeDocument(upload) {
    const result = await demo.analyzeDocument(upload);
    if (upload.documentType === 'diagnosis_certificate') { result.fields.patientName = secret; result.fields.diagnosis = clinical; }
    else result.fields.accountNumber = secret;
    return result;
  } } });
  const intent = await json(await api.request('/analyze-intent', { message: HOSPITAL_STORY }));
  assert.doesNotMatch(intent.summary, /CLINICAL|核准|給付/);
  assert.equal(intent.extractedData.patientName, null); assert.ok(!JSON.stringify(intent).includes(secret));
  const journey = await api.create({ message: HOSPITAL_STORY + ' ' + clinical + ' ' + secret, intentResult: { ...(await demo.understandIntent(HOSPITAL_STORY)), summary: clinical } });
  const document = await json(await api.upload(journey.id, 'diagnosis_certificate', { filename: secret + clinical + '.pdf' }));
  assert.equal(document.document.fields.patientName, null); assert.equal(document.document.fields.diagnosis, null); assert.equal(document.document.status, 'needs_review');
  const error = await json(await api.upload(journey.id, 'bank_passbook'), 502);
  assert.equal(error.error.code, 'AI_RESPONSE_INVALID');
  const summary = await json(await api.request(`/journeys/${journey.id}/handoff-summary`));
  const unknown = await api.create({ message: clinical, intentResult: { intent: 'unknown', serviceType: 'unknown', confidence: .2, summary: clinical, extractedData: { origin: null, destination: null, delayMinutes: null, incidentDate: null } } });
  assert.doesNotMatch(JSON.stringify(unknown), new RegExp(clinical));
  assert.doesNotMatch(JSON.stringify({ document, error, summary, logs, stored: repository.get(journey.id) }), new RegExp(`${secret}|${clinical}|accountNumber|bytes`));
});

test('invalid reported calendar dates remain null rather than causing Demo provider failure', async () => {
  const data = await createDemoProvider().understandIntent('我在 2026-02-30 住院了');
  assert.equal(data.serviceType, 'hospitalization_claim'); assert.equal(data.extractedData.incidentDate, null);
});

test('all authored hospitalization cases and metrics are executed locally, with zero external AI attempts', async () => {
  const cases = await loadHospitalDataset(); assert.ok(cases.length >= 50);
  const report = await evaluateHospitalization(cases);
  assert.equal(report.failed, 0); assert.equal(report.passed, cases.length);
  assert.equal(report.geminiRequests, 0); assert.equal(report.paidApiCalls, 0); assert.equal(report.blockedExternalAttempts, 0);
  for (const metric of Object.values(report.metrics)) { assert.ok(metric.total > 0); assert.equal(metric.passRate, 1); }
  assert.deepEqual(report.goldenPath, [35, 70, 90, 100]);
});

// Read-only use of A's current adapter validates its contract against real Express, not mocked fetch responses.
test('Developer A API adapter runs the hospital Golden Path, restores server state and handles expiration', async t => {
  const repository = new InMemoryJourneyRepository(); const api = await apiFor(t, { repository });
  const values = new Map(); const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const options = { baseUrl: api.baseUrl, storage, understand: (message, args) => understandIntent(message, { ...args, baseUrl: api.baseUrl }) };
  const client = createApiJourneyService(options);
  assert.equal(client.capabilities.manualEntry, false);
  const result = await client.analyze(HOSPITAL_STORY);
  assert.equal(result.snapshot.journey.readiness, 35);
  assert.equal((await client.uploadDocument('diagnosis_certificate', { sample: true })).journey.readiness, 70);
  assert.equal((await client.uploadDocument('bank_passbook', { sample: true })).journey.readiness, 90);
  assert.equal((await client.confirm()).journey.readiness, 100);
  const restored = createApiJourneyService(options); assert.equal(restored.restore().journey.id, result.snapshot.journey.id);
  assert.equal((await restored.sync()).journey.readiness, 100);
  assert.equal((await restored.removeDocument('bank_passbook')).journey.readiness, 70);
  repository.entries.get(result.snapshot.journey.id).expiresAt = Date.now() - 1;
  await assert.rejects(restored.sync(), { code: 'JOURNEY_NOT_FOUND' });
  assert.equal(restored.restore(), null);
});

test('knowledge-only hospitalization intents cannot silently open a scored service workflow through A adapter', async t => {
  const demo = createDemoProvider(); const repository = new InMemoryJourneyRepository();
  const api = await apiFor(t, { repository, provider: { ...demo, understandIntent: async message => ({ ...await demo.understandIntent(message), intent: 'knowledge_query' }) } });
  const client = createApiJourneyService({ baseUrl: api.baseUrl, understand: message => understandIntent(message, { baseUrl: api.baseUrl }) });
  await assert.rejects(client.analyze('住院理賠需要什麼文件？'), { code: 'SERVICE_NOT_SUPPORTED', status: 409 });
  assert.equal(repository.entries.size, 0); assert.equal(client.restore(), null);
});
