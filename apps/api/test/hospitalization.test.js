import test from 'node:test';
import assert from 'node:assert/strict';
import { intentDisposition, IntentDataSchema } from '../../../shared/intelligence.js';
import { normalizeGeminiIntent, normalizeGeminiDocument, GeminiDocumentSchema, documentJsonSchema, intentJsonSchema } from '../src/ai/schemas.js';
import { createDemoProvider } from '../src/ai/demoProvider.js';
import { SYSTEM_PROMPT } from '../src/ai/prompts/intentPrompt.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createGeminiProvider } from '../src/services/gemini.service.js';
import { documentVerified } from '../src/services/documentValidationService.js';
import { validateGroundedAnswer, answerKnowledge } from '../src/services/knowledgeAnswerService.js';
import { getSources, retrieveAnswerContext } from '../src/services/knowledgeService.js';
import { ServiceJourneySchema, NavigationTargetSchema } from '../../../shared/journey.js';
import { HostMessageSchema, NaviMessageSchema, naviMessage, readMessage } from '../../../shared/embed.js';
import { hospitalDestinations, calculateStay, matchPartnerHospital, normalizeHospitalName, HOSPITAL_WEIGHTS } from '../../../shared/hospitalization.js';
import { cardifRecords, getCardifRecord } from '../../../knowledge/cardif.js';
import { samplePdf } from './sampleDocuments.js';
import { checkEvidenceConsistency } from '../src/services/evidenceConsistencyService.js';
import { randomUUID } from 'node:crypto';

const story = '我上週在台中榮總住院五天，要怎麼申請理賠？';
const config = { ...loadConfig({ AI_MODE: 'demo' }), rateLimit: 300 };
async function server(t, provider = createDemoProvider()) {
  const http = createApp(config, provider).listen(0, '127.0.0.1');
  await new Promise(resolve => http.once('listening', resolve));
  t.after(() => new Promise(resolve => http.close(resolve)));
  const base = `http://127.0.0.1:${http.address().port}/api`;
  return {
    get: path => fetch(base + path),
    post: (path, body) => fetch(base + path, { method: 'POST', ...(body instanceof FormData ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }),
    async create(message = story, intentResult) { const res = await this.post('/journeys', { message, ...(intentResult ? { intentResult } : {}) }); assert.equal(res.status, 201); return ServiceJourneySchema.parse(await res.json()); },
    async upload(id, type) { const form = new FormData(); form.set('file', new Blob([samplePdf(type)], { type: 'application/pdf' }), 'NAVI-synthetic.pdf'); form.set('documentType', type); return this.post(`/journeys/${id}/documents`, form); },
    remove: (id, doc) => fetch(`${base}/journeys/${id}/documents/${doc}`, { method: 'DELETE' }),
  };
}
const rawFields = { passengerName: null, flightNumber: null, origin: null, destination: null, departureDate: null, actualDepartureDate: null, scheduledDeparture: null, actualDeparture: null };
const diagnosisRaw = overrides => ({ documentType: 'diagnosis_certificate', confidence: 0.97, fields: { ...rawFields, hospitalName: '臺中榮民總醫院', patientName: 'NAVI SYNTHETIC PATIENT', admissionDate: '2026-10-01', dischargeDate: '2026-10-05', certificateKind: 'diagnosis_certificate', reportedInpatientDays: null, ...overrides } });
const passbookRaw = overrides => ({ documentType: 'bank_passbook', confidence: 0.97, fields: { ...rawFields, accountHolder: 'NAVI SYNTHETIC PATIENT', bankName: 'NAVI SYNTHETIC BANK', accountLast4: '1234', ...overrides } });
const response = raw => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] }), { status: 200 });

// Added by Developer A for the 住院醫療理賠 Golden Path. Existing flight-delay behaviour is untouched.
const empty = { origin: null, destination: null, delayMinutes: null, incidentDate: null };

test('hospitalization_claim is a supported service type', () => {
  const data = IntentDataSchema.parse({ intent: 'service_request', serviceType: 'hospitalization_claim', confidence: 0.9, summary: '住院後想申請理賠', extractedData: empty });
  assert.equal(intentDisposition(data), 'supported');
  assert.equal(intentDisposition({ ...data, confidence: 0.3 }), 'human_review');
});

test('Gemini aliases normalise to hospitalization_claim and never invent details', () => {
  for (const serviceType of ['hospital_claim', 'Hospitalization', 'medical-claim', 'inpatient claim']) {
    const result = normalizeGeminiIntent({ intent: 'claim', serviceType, confidence: 0.92, summary: '住院理賠', extractedData: empty });
    assert.equal(result.serviceType, 'hospitalization_claim', serviceType);
    assert.equal(result.intent, 'service_request');
    assert.deepEqual(result.extractedData, empty);
  }
});

test('the intent prompt describes the new type and the demo provider recognises it', async () => {
  assert.match(SYSTEM_PROMPT, /hospitalization_claim/);
  const demo = createDemoProvider();
  const result = await demo.understandIntent('我上週在台中榮總住院五天，要怎麼申請理賠？');
  assert.equal(result.serviceType, 'hospitalization_claim');
  assert.equal(result.intent, 'service_request');
  assert.equal((await demo.understandIntent('我的班機延誤了七小時')).serviceType, 'flight_delay');
});

test('Chinese, English and everyday hospital descriptions preserve facts; negation and outpatient do not open inpatient journeys', async () => {
  const demo = createDemoProvider();
  for (const message of [story, '我在臺大住院五天，要申請理賠', '中榮住院後要準備文件', 'I was hospitalized for five days. How do I file a claim?', 'I was admitted to hospital for surgery.']) {
    assert.equal((await demo.understandIntent(message)).serviceType, 'hospitalization_claim', message);
  }
  const data = await demo.understandIntent(story);
  assert.equal(data.extractedData.hospitalName, '台中榮總');
  assert.equal(data.extractedData.reportedInpatientDays, 5);
  assert.equal(data.extractedData.admissionDate, null);
  assert.equal((await demo.understandIntent('I was hospitalized for five days.')).extractedData.reportedInpatientDays, 5);
  for (const message of ['我只有門診開刀，沒有住院，要申請理賠', '我看門診，不是住院', '門診醫療理賠怎麼辦', '我有個問題', 'I was not hospitalized, outpatient treatment only', "I wasn't hospitalized."]) assert.equal((await demo.understandIntent(message)).serviceType, 'unknown', message);
  assert.equal((await demo.understandIntent('我住院五天，但沒有住院證明')).serviceType, 'hospitalization_claim');
});

test('ambiguous medical aliases, extra business fields and invalid structured dates are rejected safely', () => {
  const base = { intent: 'claim', serviceType: 'medical_claim', confidence: 0.99, summary: '門診手術後查詢理賠', extractedData: empty };
  assert.equal(normalizeGeminiIntent(base).serviceType, 'unknown');
  assert.ok(normalizeGeminiIntent(base).confidence <= 0.4);
  for (const bad of [{ ...base, readiness: 100 }, { ...base, currentStage: 'READY_TO_PROCEED' }, { ...base, extractedData: { ...empty, admissionDate: '2026-02-30' } }]) assert.throws(() => normalizeGeminiIntent(bad));
  assert.deepEqual(intentJsonSchema.properties.serviceType.enum, IntentDataSchema.shape.serviceType.options);
  assert.deepEqual(documentJsonSchema.properties.documentType.enum, GeminiDocumentSchema.shape.documentType.options);
});

test('optional hospital facts cannot inflate legacy flight confidence above one', () => {
  const result = normalizeGeminiIntent({ intent: 'claim', serviceType: 'flight_delay', confidence: 1, summary: '班機延誤', extractedData: { origin: 'Tokyo', destination: 'Taipei', delayMinutes: 420, incidentDate: '2026-10-01', hospitalName: 'NAVI SYNTHETIC HOSPITAL', reportedInpatientDays: 5 } });
  assert.equal(result.confidence, 1);
  assert.equal(result.serviceType, 'flight_delay');
});

test('hospital aliases match exact campuses; unnamed and unlisted branches are not treated as partners', () => {
  for (const name of ['台中榮總', '臺中榮民總醫院', '中榮']) assert.equal(matchPartnerHospital(name), '臺中榮民總醫院');
  for (const name of ['台大', '臺大醫院']) assert.equal(matchPartnerHospital(name), '臺大醫院');
  assert.equal(matchPartnerHospital('台中榮總埔里分院'), '臺中榮民總醫院埔里分院');
  assert.equal(matchPartnerHospital('台中榮總不存在分院'), null);
  assert.equal(matchPartnerHospital('榮總'), null);
  assert.equal(matchPartnerHospital('合成非合作醫院'), null);
  assert.equal(normalizeHospitalName('台 中 榮 總'), '臺中榮民總醫院');
});

test('hospital server Golden Path 35→70→90→100 and remove/re-upload revoke confirmation', async t => {
  const api = await server(t); const journey = await api.create();
  assert.equal(journey.readiness, 35); assert.equal(journey.currentStage, 'EVIDENCE_COLLECTION');
  assert.equal(journey.claimContext.hospital.matchedName, '臺中榮民總醫院');
  assert.equal(journey.claimContext.inpatient.source, 'user_reported');
  assert.equal(journey.nextAction.target, 'diagnosis_certificate');
  assert.equal(journey.requirements.reduce((n, r) => n + r.weight, 0), 100);
  assert.deepEqual(Object.fromEntries(journey.requirements.filter(r => r.required).map(r => [r.id, r.weight])), HOSPITAL_WEIGHTS);
  assert.ok(journey.requirements.filter(r => !r.required).every(r => r.weight === 0 && r.name.includes('依病況')));
  assert.ok(journey.sources.every(s => s.type === 'public_site_snapshot' && s.sourceId === s.id));
  const first = await (await api.upload(journey.id, 'diagnosis_certificate')).json();
  assert.equal(first.journey.readiness, 70); assert.equal(first.document.fields.inpatientDays, 5);
  assert.equal(first.document.fields.inpatientDaysSource, 'dates'); assert.equal(first.document.fields.diagnosis, null);
  assert.equal(first.document.isMock, true); assert.equal(first.journey.nextAction.target, 'bank_passbook');
  const second = await (await api.upload(journey.id, 'bank_passbook')).json();
  assert.equal(second.journey.readiness, 90); assert.equal(second.journey.currentStage, 'READY_FOR_REVIEW');
  const reviewed = await (await api.post(`/journeys/${journey.id}/review`, { confirmed: true })).json();
  assert.equal(reviewed.readiness, 100); assert.equal(reviewed.currentStage, 'READY_TO_PROCEED');
  assert.equal(reviewed.nextAction.destination.anchor, 'service-claim-hospital-upload');
  const removed = await (await api.remove(journey.id, second.document.id)).json();
  assert.equal(removed.readiness, 70); assert.equal(removed.confirmed, false);
  assert.equal((await (await api.upload(journey.id, 'bank_passbook')).json()).journey.readiness, 90);
  assert.deepEqual((await (await api.get(`/journeys/${journey.id}/handoff-summary`)).json()).missing, ['資料確認']);
  const removedDiagnosis = await (await api.remove(journey.id, first.document.id)).json();
  assert.equal(removedDiagnosis.readiness, 55); assert.equal(removedDiagnosis.nextAction.target, 'diagnosis_certificate');
});

test('medical extraction uses backend day calculation, printed-day provenance, null missing fields and no full account or clinical details', () => {
  const doc = normalizeGeminiDocument(diagnosisRaw());
  assert.equal(calculateStay(doc.fields).days, 5); assert.equal(documentVerified(doc, 0.75), true);
  assert.equal(doc.fields.diagnosis, null); assert.equal(doc.fields.inpatientDays, undefined);
  assert.deepEqual(calculateStay({ admissionDate: '2026-02-30', dischargeDate: '2026-03-05' }), { days: null, source: null });
  const proof = normalizeGeminiDocument(diagnosisRaw({ admissionDate: null, dischargeDate: null, reportedInpatientDays: 4, certificateKind: 'hospitalization_proof' }));
  assert.deepEqual(calculateStay(proof.fields), { days: 4, source: 'printed_days' }); assert.equal(documentVerified(proof, 0.75), true);
  for (const changes of [{ patientName: null }, { hospitalName: null }, { admissionDate: null, dischargeDate: null }, { dischargeDate: '2026-09-01' }, { reportedInpatientDays: 99 }]) assert.equal(documentVerified(normalizeGeminiDocument(diagnosisRaw(changes)), 0.75), false);
  for (const field of ['accountHolder', 'bankName', 'accountLast4']) assert.equal(documentVerified(normalizeGeminiDocument(passbookRaw({ [field]: null })), 0.75), false);
  assert.throws(() => normalizeGeminiDocument(passbookRaw({ accountNumber: '00000000001234' })));
  assert.throws(() => normalizeGeminiDocument(diagnosisRaw({ inpatientDays: 99 })));
  assert.throws(() => normalizeGeminiDocument({ ...diagnosisRaw(), readiness: 100 }));
});

test('missing diagnosis/passbook fields need human review instead of becoming verified', async t => {
  for (const [type, field] of [['diagnosis_certificate', 'patientName'], ['bank_passbook', 'accountLast4']]) {
    const demo = createDemoProvider();
    const api = await server(t, { ...demo, analyzeDocument: async (...args) => { const doc = await demo.analyzeDocument(...args); doc.fields[field] = null; return doc; } });
    const journey = await api.create(); const result = await (await api.upload(journey.id, type)).json();
    assert.equal(result.document.status, 'needs_review'); assert.equal(result.journey.currentStage, 'HUMAN_REVIEW');
    assert.equal(result.journey.readiness, 35); assert.equal(result.journey.nextAction.type, 'CONTACT_SPECIALIST');
    assert.equal((await api.post(`/journeys/${journey.id}/review`, { confirmed: true })).status, 409);
  }
});

test('hospital, dates and patient mismatches flag evidence; correction clears human review', async t => {
  const demo = createDemoProvider();
  for (const [field, value, issueType] of [['hospitalName', '臺大醫院', 'HOSPITAL_NAME_MISMATCH'], ['dischargeDate', '2026-10-06', 'INPATIENT_DAYS_MISMATCH']]) {
    const api = await server(t, { ...demo, analyzeDocument: async (...args) => { const doc = await demo.analyzeDocument(...args); doc.fields[field] = value; return doc; } });
    const journey = await api.create(); const result = await (await api.upload(journey.id, 'diagnosis_certificate')).json();
    assert.equal(result.journey.currentStage, 'HUMAN_REVIEW'); assert.equal(result.document.status, 'needs_review');
    assert.ok(result.journey.consistencyIssues.some(issue => issue.type === issueType));
  }
  let count = 0;
  const api = await server(t, { ...demo, analyzeDocument: async (...args) => { const doc = await demo.analyzeDocument(...args); if (doc.documentType === 'bank_passbook' && count++ === 0) doc.fields.accountHolder = 'NAVI OTHER SYNTHETIC PATIENT'; return doc; } });
  const journey = await api.create(); await api.upload(journey.id, 'diagnosis_certificate');
  const mismatch = await (await api.upload(journey.id, 'bank_passbook')).json();
  assert.equal(mismatch.journey.readiness, 70); assert.equal(mismatch.journey.currentStage, 'HUMAN_REVIEW');
  assert.equal(mismatch.journey.consistencyIssues[0].type, 'PATIENT_NAME_MISMATCH');
  const fixed = await (await api.upload(journey.id, 'bank_passbook')).json();
  assert.equal(fixed.journey.readiness, 90); assert.deepEqual(fixed.journey.consistencyIssues, []);
});

test('non-partner hospital offers conditional navigation; low-confidence/unsupported journeys remain safe', async t => {
  const api = await server(t);
  const nonPartner = await api.create('我在合成非合作醫院住院', { intent: 'service_request', serviceType: 'hospitalization_claim', confidence: 0.94, summary: '合成非合作醫院住院', extractedData: { ...empty, hospitalName: '合成非合作醫院' } });
  assert.equal(nonPartner.claimContext.channels.find(c => c.id === 'hospital_upload').available, false);
  assert.ok(nonPartner.claimContext.channels.find(c => c.id === 'union_chain').notes.some(note => note.includes('10日內')));
  const low = await api.create(story, { intent: 'service_request', serviceType: 'hospitalization_claim', confidence: 0.64, summary: '待確認的住院需求', extractedData: empty });
  assert.equal(low.currentStage, 'HUMAN_REVIEW'); assert.equal((await api.upload(low.id, 'diagnosis_certificate')).status, 409);
  const unsupported = await api.create('我要更改地址');
  assert.equal(unsupported.supported, false); assert.equal(unsupported.readiness, 0);
  assert.equal((await api.upload(unsupported.id, 'diagnosis_certificate')).status, 409);
});

test('explicit admission/discharge facts are cross-checked independently of the day count', () => {
  const doc = { ...normalizeGeminiDocument(diagnosisRaw()), id: randomUUID() };
  const issues = checkEvidenceConsistency([doc], { admissionDate: '2026-10-02', dischargeDate: '2026-10-06' });
  assert.deepEqual(issues.map(issue => issue.type), ['ADMISSION_DATE_MISMATCH', 'DISCHARGE_DATE_MISMATCH']);
  assert.ok(issues.every(issue => !issue.message.includes('NAVI SYNTHETIC PATIENT')));
});

test('misclassified negated hospitalization cannot create a hospital workflow', async t => {
  const provider = { ...createDemoProvider(), understandIntent: async () => ({ intent: 'service_request', serviceType: 'hospitalization_claim', confidence: 0.99, summary: '模型錯誤判定住院', extractedData: empty }) };
  const api = await server(t, provider);
  const journey = await api.create('我只有門診，沒有住院');
  assert.equal(journey.serviceType, 'unknown'); assert.equal(journey.supported, false); assert.equal(journey.readiness, 0);
  const supplied = await api.create('我只有門診，沒有住院', await provider.understandIntent());
  assert.equal(supplied.serviceType, 'unknown'); assert.equal(supplied.readiness, 0);
});

test('injected Gemini transport supports hospital documents and never controls workflow or readiness', async t => {
  let calls = 0;
  const live = createGeminiProvider({ ...config, aiMode: 'live', apiKey: 'synthetic-test-key', freeTierConfirmed: true }, async (_url, options) => {
    const body = JSON.parse(options.body); calls++;
    if (calls === 1) return response({ intent: 'service_request', serviceType: 'hospitalization_claim', confidence: 0.97, summary: '使用者回報住院五天', extractedData: { ...empty, hospitalName: '台中榮總', reportedInpatientDays: 5 } });
    assert.ok(body.contents[0].parts.some(part => part.inlineData?.mimeType === 'application/pdf'));
    return response(calls === 2 ? diagnosisRaw() : passbookRaw());
  });
  const api = await server(t, live); const journey = await api.create();
  assert.equal(journey.readiness, 35);
  const diagnosis = await (await api.upload(journey.id, 'diagnosis_certificate')).json();
  assert.equal(diagnosis.journey.readiness, 70); assert.equal(diagnosis.document.isMock, false);
  const bank = await (await api.upload(journey.id, 'bank_passbook')).json();
  assert.equal(bank.journey.readiness, 90); assert.equal(bank.document.fields.accountLast4, '1234');
  assert.equal((await (await api.post(`/journeys/${journey.id}/review`, { confirmed: true })).json()).readiness, 100);
  assert.equal(calls, 3); // Injected transport only; networkGuard forbids real Gemini requests.
});

test('hospital knowledge and navigation come from valid local sources; fake IDs and quotes are rejected', async () => {
  for (const question of ['住院理賠需要哪些文件？', '我要搬家改地址', '受益人變更申請書在哪下載', '保單借款怎麼辦', '密碼輸錯被鎖定', '官網服務入口在哪']) {
    const context = retrieveAnswerContext(question); assert.ok(context, question);
    const answer = await answerKnowledge(question, { provider: createDemoProvider(), config });
    assert.equal(answer.supported, true); assert.equal(answer.answerMode, 'demo');
    for (const source of answer.sources) {
      assert.equal(source.type, 'public_site_snapshot'); assert.equal(source.sourceId, source.id);
      assert.ok(getCardifRecord(source.id)); assert.equal(source.retrievedAt, '2026-10-06');
      NavigationTargetSchema.parse(source.navigationDestination);
    }
    for (const line of answer.answer.split('\n')) assert.ok(context.sources.some(source => source.content.split('\n').includes(line)), line);
    assert.throws(() => validateGroundedAnswer({ answer: context.answer, confidence: 1, supported: true, sourceIds: ['invented-source'] }, context));
    assert.throws(() => validateGroundedAnswer({ answer: '住院五天一定核付十萬元', confidence: 1, supported: true, sourceIds: context.sourceIds }, context));
  }
  assert.equal(getSources(['invented-source']).length, 0);
  for (const item of cardifRecords) NavigationTargetSchema.parse(item.navigationDestination);
});

test('knowledge financial decisions, unknown questions and unsupported amounts never call a provider', async () => {
  let calls = 0;
  for (const question of ['我一定符合理賠資格嗎', '住院五天可以賠嗎', '推薦哪個保單', '火星天氣？']) {
    const answer = await answerKnowledge(question, { provider: { answerKnowledge: () => { calls++; throw new Error('must not call'); } }, config });
    assert.equal(answer.supported, false, question); assert.deepEqual(answer.sources, []);
  }
  assert.equal(calls, 0);
});

test('navigation rejects syntactically valid but unlisted destinations; postMessage requires exact origin/window', () => {
  const valid = hospitalDestinations.documents;
  for (const patch of [{ path: '/admin' }, { anchor: 'made-up-anchor' }, { path: '/services/forms' }, { source: { ...valid.source, url: 'https://life.cardif.com.tw/zh/invented' } }]) assert.equal(NavigationTargetSchema.safeParse({ ...valid, ...patch }).success, false);
  const frame = {}; const data = naviMessage('navi:navigate', { destination: valid });
  const options = { schema: NaviMessageSchema, allowedOrigins: ['http://127.0.0.1:5173'], expectedSource: frame };
  assert.deepEqual(readMessage({ origin: 'http://127.0.0.1:5173', source: frame, data }, options), data);
  for (const event of [{ origin: 'http://localhost:5173', source: frame, data }, { origin: 'http://127.0.0.1:5173', source: {}, data }]) assert.equal(readMessage(event, options), null);
  assert.equal(readMessage({ origin: 'http://127.0.0.1:5173', source: frame, data }, { ...options, expectedSource: null }), null);
  assert.equal(readMessage({ origin: 'http://127.0.0.1:5173', source: frame, data }, { ...options, schema: HostMessageSchema }), null);
});
