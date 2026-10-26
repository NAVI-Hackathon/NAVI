import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { samplePdfFile } from '../../web/src/mocks/sampleDocuments.js';
import { samplePdf, syntheticPdf } from './sampleDocuments.js';
import { syntheticImages } from './syntheticImages.js';
import { result } from './fixtures.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDemoProvider } from '../src/ai/demoProvider.js';
import { createGeminiProvider } from '../src/services/gemini.service.js';
import { ApiError } from '../src/middleware/errorHandler.js';
import { offlineNetworkStats } from './networkGuard.js';

const origin = 'https://app.navitw.com';
const story = '合成測試：我在 NAVI SYNTHETIC HOSPITAL 住院五天，想申請理賠。';
const cases = [
  ['diagnosis_certificate', 800, 'aaa742fe89b3c5fc3d913f06dbcd020faa0ef9b878fe530b701040384bb63daa'],
  ['bank_passbook', 746, '3b1e2154311ef33f2033a7e8e146754baf602751b299901723511d2bc410d68b'],
];
const settings = () => ({ ...loadConfig({ NODE_ENV: 'production', AI_MODE: 'live', AI_PUBLIC_SYNTHETIC: 'true', GEMINI_API_KEY: 'synthetic-test-key', GEMINI_FREE_TIER_CONFIRMED: 'true', AI_USAGE_FILE: '/private/synthetic-test-ledger.json', WEB_ORIGINS: origin, AI_SYNTHETIC_DOCUMENT_SHA256: cases.map(entry => entry[2]).join(',') }), rateLimit: 300 });
function transportSettings(t) {
  const directory = mkdtempSync(join(tmpdir(), 'navi-synthetic-verification-')); chmodSync(directory, 0o700);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { ...settings(), usageFile: join(directory, 'usage.json') };
}
async function api(t, config, provider) {
  const server = createApp(config, provider).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, data, cookie, method = data ? 'POST' : 'GET') => fetch(base + path, { method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, ...(data ? { body: data instanceof FormData ? data : JSON.stringify(data) } : {}) });
  return { request };
}
const multipart = async type => { const form = new FormData(); form.set('file', samplePdfFile(type)); form.set('documentType', type); return form; };
const cookieOf = response => response.headers.get('set-cookie').split(';')[0];
const jsonResponse = raw => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] });
const nullableFields = { passengerName: null, flightNumber: null, origin: null, destination: null, departureDate: null, actualDepartureDate: null, scheduledDeparture: null, actualDeparture: null };

for (const [type, size, hash] of cases) test(`Frontend-generated ${type} bytes match independent expected size/hash and backend fixture`, async () => {
  const file = samplePdfFile(type), bytes = Buffer.from(await file.arrayBuffer());
  assert.equal(file.type, 'application/pdf'); assert.equal(bytes.length, size);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash); assert.ok(bytes.equals(samplePdf(type)));
  const text = bytes.toString('ascii');
  assert.match(text, /NAVI SYNTHETIC/); assert.match(text, /NOT A VALID (MEDICAL|BANK) DOCUMENT/);
  assert.doesNotMatch(text, /ignore|override|javascript|embeddedfile|cardif|paribas/i);
});

test('A whitelisted PDF reaches the model transport unchanged; low-confidence extraction earns no credit', async t => {
  const config = transportSettings(t); let docCalls = 0; const demo = createDemoProvider();
  const gemini = createGeminiProvider(config, async (_url, init) => {
    const part = JSON.parse(init.body).contents[0].parts[1].inlineData;
    const bytes = Buffer.from(part.data, 'base64'); assert.equal(part.mimeType, 'application/pdf');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), cases[0][2]); docCalls++;
    return jsonResponse({ documentType: 'diagnosis_certificate', confidence: .2, fields: { ...nullableFields, patientName: null, hospitalName: null, admissionDate: null, dischargeDate: null, certificateKind: null, reportedInpatientDays: null } });
  });
  const service = await api(t, config, { ...gemini, understandIntent: message => demo.understandIntent(message) });
  const created = await service.request('/journeys', { message: story }); const cookie = cookieOf(created); const journey = await created.json();
  const uploaded = await service.request(`/journeys/${journey.id}/documents`, await multipart('diagnosis_certificate'), cookie);
  assert.equal(uploaded.status, 200); const result = await uploaded.json();
  assert.equal(result.document.status, 'needs_review'); assert.equal(result.document.isMock, false); assert.equal(result.document.source, 'live');
  assert.deepEqual(result.document.matchedRequirements, []); assert.equal(result.journey.readiness, 35); assert.equal(docCalls, 1);
  assert.equal(uploaded.headers.get('X-NAVI-AI-Mode'), 'live');
});

test('A whitelisted document can still be rejected as unknown by the model, without fixture substitution', async t => {
  const config = transportSettings(t), demo = createDemoProvider(); let calls = 0;
  const provider = createGeminiProvider(config, async () => { calls++; return jsonResponse({ documentType: 'unknown', confidence: .2, fields: nullableFields }); });
  const service = await api(t, config, { ...provider, understandIntent: message => demo.understandIntent(message) });
  const created = await service.request('/journeys', { message: story }); const cookie = cookieOf(created), journey = await created.json();
  const res = await service.request(`/journeys/${journey.id}/documents`, await multipart('bank_passbook'), cookie);
  assert.equal(res.status, 422); assert.equal((await res.json()).error.code, 'DOCUMENT_UNRECOGNIZED'); assert.equal(calls, 1);
  assert.equal((await (await service.request(`/journeys/${journey.id}`, null, cookie)).json()).readiness, 35);
});

test('Changing PDF bytes or sending a claimed hash cannot bypass the server fingerprint', async t => {
  let calls = 0; const demo = createDemoProvider();
  const service = await api(t, settings(), { ...demo, mode: 'live', analyzeDocument: async () => { calls++; assert.fail('Must not reach the provider'); } });
  const created = await service.request('/journeys', { message: story }); const cookie = cookieOf(created), journey = await created.json();
  const changed = new FormData(); changed.set('file', new File([samplePdf('diagnosis_certificate'), ' '], 'diagnosis_certificate-sample.pdf', { type: 'application/pdf' })); changed.set('documentType', 'diagnosis_certificate');
  const denied = await service.request(`/journeys/${journey.id}/documents`, changed, cookie);
  assert.equal(denied.status, 422); assert.equal((await denied.json()).error.code, 'SYNTHETIC_DOCUMENT_REQUIRED');
  const claimed = await multipart('diagnosis_certificate'); claimed.set('sha256', cases[0][2]);
  assert.equal((await service.request(`/journeys/${journey.id}/documents`, claimed, cookie)).status, 400); assert.equal(calls, 0);
});

test('Session AI-operation cap includes uploads and re-submissions; deterministic case operations still work', async t => {
  let calls = 0; const demo = createDemoProvider();
  const service = await api(t, { ...settings(), sessionRequestLimit: 2 }, { ...demo, mode: 'live', understandIntent: async message => { calls++; return demo.understandIntent(message); } });
  const first = await service.request('/intelligence/understand', { message: story }); const cookie = cookieOf(first); await first.json();
  const created = await service.request('/journeys', { message: story }, cookie); const journey = await created.json();
  const denied = await service.request(`/journeys/${journey.id}/documents`, await multipart('diagnosis_certificate'), cookie);
  assert.equal(denied.status, 429); assert.equal((await denied.json()).error.code, 'AI_SESSION_LIMIT_REACHED'); assert.equal(calls, 1);
  assert.equal((await service.request(`/journeys/${journey.id}/handoff-summary?enhance=true`, null, cookie)).status, 429);
  assert.equal((await service.request('/knowledge/answer', { question: '醫起通是什麼？' }, cookie)).status, 429);
  for (const suffix of ['', '/explanation', '/handoff-summary']) assert.equal((await service.request(`/journeys/${journey.id}${suffix}`, null, cookie)).status, 200);
  const other = await service.request('/intelligence/understand', { message: story }); assert.equal(other.status, 200); assert.notEqual(cookieOf(other), cookie);
});

test('Parallel requests in one session cannot race past its cap', async t => {
  let calls = 0; const demo = createDemoProvider();
  const service = await api(t, { ...settings(), sessionRequestLimit: 2 }, { ...demo, mode: 'live', understandIntent: async message => { calls++; return demo.understandIntent(message); } });
  const first = await service.request('/intelligence/understand', { message: story }); const cookie = cookieOf(first); await first.json();
  const results = await Promise.all(Array.from({ length: 4 }, () => service.request('/intelligence/understand', { message: story }, cookie)));
  assert.equal(results.filter(r => r.status === 200).length, 1); assert.equal(results.filter(r => r.status === 429).length, 3); assert.equal(calls, 2);
});

test('A failed generation consumes the session operation; client re-submission cannot exceed its cap', async t => {
  let calls = 0;
  const service = await api(t, { ...settings(), sessionRequestLimit: 1 }, { mode: 'live', understandIntent: async () => { calls++; throw new ApiError('AI_PROVIDER_ERROR', '合成測試錯誤', 502, true); } });
  const failed = await service.request('/intelligence/understand', { message: story }); const cookie = cookieOf(failed);
  assert.equal(failed.status, 502); assert.equal((await failed.json()).error.code, 'AI_PROVIDER_ERROR');
  const repeated = await service.request('/intelligence/understand', { message: story }, cookie);
  assert.equal(repeated.status, 429); assert.equal((await repeated.json()).error.code, 'AI_SESSION_LIMIT_REACHED'); assert.equal(calls, 1);
});

test('Restricted Live rejects automatic retries and invalid session limits; local evaluation remains compatible', () => {
  for (const mode of [{ NODE_ENV: 'production' }, { AI_SYNTHETIC_TEST_ONLY: 'true' }]) assert.throws(() => loadConfig({ ...mode, AI_MAX_ATTEMPTS: '2' }));
  for (const limit of ['0', '-1', '1.5', '21', 'NaN']) assert.throws(() => loadConfig({ AI_SESSION_REQUEST_LIMIT: limit }));
  assert.equal(loadConfig({}).sessionRequestLimit, 6); assert.equal(loadConfig({ AI_MAX_ATTEMPTS: '2' }).aiMaxAttempts, 2);
  assert.equal(offlineNetworkStats().externalRequests, 0);
});

const operatorToken = 'synthetic-operator-at-least-thirty-two-characters';
const manualStory = 'I was hospitalized and would like help with the claim process.';
const medical = patientName => ({ documentType: 'diagnosis_certificate', confidence: .97, fields: { ...nullableFields, patientName, hospitalName: 'NAVI TEST HOSPITAL', admissionDate: '2026-10-01', dischargeDate: '2026-10-05', certificateKind: 'hospitalization_proof', reportedInpatientDays: null } });
const bank = accountHolder => ({ documentType: 'bank_passbook', confidence: .97, fields: { ...nullableFields, accountHolder, bankName: 'NAVI TEST BANK', accountLast4: '1234' } });
const customPdf = name => syntheticPdf(['SYNTHETIC TEST ONLY - NOT A VALID MEDICAL DOCUMENT', 'Hospital: NAVI TEST HOSPITAL', `Patient: ${name}`, 'Admission: 2026-10-01', 'Discharge: 2026-10-05']);
function fileForm(bytes, mime = 'application/pdf', filename = 'custom.pdf', type = 'diagnosis_certificate') {
  const form = new FormData(); form.set('file', new File([bytes], filename, { type: mime })); form.set('documentType', type); return form;
}
async function controlled(t, respond, overrides = {}) {
  // Transport is injected, not a real API call; durable quota behavior has separate restart/race tests.
  const config = { ...settings(), usageFile: '', sessionToken: operatorToken, sessionRequestLimit: 20, ...overrides };
  const requests = []; const buffers = [];
  const gemini = createGeminiProvider(config, async (_url, init) => {
    const body = JSON.parse(init.body), media = body.contents[0].parts[1].inlineData;
    const bytes = Buffer.from(media.data, 'base64'); requests.push({ bytes, mime: media.mimeType });
    assert.equal(body.tools, undefined);
    return jsonResponse(await respond(bytes, media.mimeType));
  });
  const provider = { ...gemini, understandIntent: async () => result('hospitalization_claim'), analyzeDocument(upload, signal) { buffers.push(upload.bytes); return gemini.analyzeDocument(upload, signal); } };
  const service = await api(t, config, provider);
  const activated = await service.request('/test-sessions', { token: operatorToken, syntheticOnly: true });
  assert.equal(activated.status, 201); const cookie = cookieOf(activated), activation = await activated.json();
  const create = async () => { const res = await service.request('/journeys', { message: manualStory }, cookie); assert.equal(res.status, 201); return res.json(); };
  return { ...service, cookie, activation, requests, buffers, create };
}

test('Server-owned upload capability allows arbitrary synthetic PDFs only in an authorized session', async t => {
  const service = await controlled(t, () => medical('NAVI TEST PERSON A'));
  assert.deepEqual(service.activation.documentUpload, { builtInSynthetic: true, userProvidedSynthetic: true, realPersonalDocuments: false });
  const status = await (await service.request('/ai/status', null, service.cookie)).json();
  assert.deepEqual(status.documentUpload, service.activation.documentUpload);
  const publicStatus = await (await service.request('/ai/status')).json();
  assert.equal(publicStatus.documentUpload.userProvidedSynthetic, false);
  const forged = await service.request('/test-sessions', { token: 'wrong', syntheticOnly: true, operator: true });
  assert.equal(forged.status, 403);
  const journey = await service.create(), bytes = customPdf('NAVI TEST PERSON A');
  assert.ok(!cases.some(entry => entry[2] === createHash('sha256').update(bytes).digest('hex')));
  const res = await service.request(`/journeys/${journey.id}/documents`, fileForm(bytes), service.cookie);
  assert.equal(res.status, 200); assert.ok(service.requests[0].bytes.equals(bytes));
  assert.equal((await res.json()).document.isMock, false);
  assert.ok(service.buffers[0].every(byte => byte === 0), 'Original upload buffer is cleared after processing');
});

test('Different uploaded PDF contents produce different extracted fields, never a documentType fixture', async t => {
  const service = await controlled(t, bytes => medical(bytes.includes(Buffer.from('PERSON B')) ? 'NAVI TEST PERSON B' : 'NAVI TEST PERSON A'));
  for (const name of ['NAVI TEST PERSON A', 'NAVI TEST PERSON B']) {
    const journey = await service.create();
    const response = await service.request(`/journeys/${journey.id}/documents`, fileForm(customPdf(name)), service.cookie);
    assert.equal(response.status, 200); const data = await response.json();
    assert.equal(data.document.fields.patientName, name); assert.equal(data.journey.readiness, 70);
  }
  assert.equal(service.requests.length, 2); assert.ok(!service.requests[0].bytes.equals(service.requests[1].bytes));
});

for (const [mime, base64] of Object.entries(syntheticImages)) test(`Non-whitelisted ${mime} content reaches the Live transport; unrelated imagery earns no readiness`, async t => {
  const service = await controlled(t, () => ({ documentType: 'unknown', confidence: .1, fields: nullableFields }));
  const journey = await service.create(), bytes = Buffer.from(base64, 'base64');
  const res = await service.request(`/journeys/${journey.id}/documents`, fileForm(bytes, mime, `photo.${mime.split('/')[1]}`), service.cookie);
  assert.equal(res.status, 422); assert.equal((await res.json()).error.code, 'DOCUMENT_UNRECOGNIZED');
  assert.equal(service.requests[0].mime, mime); assert.ok(service.requests[0].bytes.equals(bytes));
  const after = await (await service.request(`/journeys/${journey.id}`, null, service.cookie)).json();
  assert.equal(after.readiness, 35); assert.deepEqual(after.documents, []);
});

test('Model classification overrides the selected upload slot; rejected results are not saved', async t => {
  const service = await controlled(t, () => bank('NAVI TEST PERSON A'));
  const journey = await service.create();
  const res = await service.request(`/journeys/${journey.id}/documents`, fileForm(customPdf('NAVI TEST PERSON A')), service.cookie);
  assert.equal(res.status, 422); assert.equal((await res.json()).error.code, 'DOCUMENT_TYPE_MISMATCH');
  const after = await (await service.request(`/journeys/${journey.id}`, null, service.cookie)).json();
  assert.equal(after.readiness, 35); assert.deepEqual(after.documents, []);
});

test('Authorized user uploads retain deterministic 35 → 70 → 90 → 100 and removal rollback', async t => {
  const service = await controlled(t, bytes => bytes.includes(Buffer.from('BANK PASSBOOK')) ? bank('NAVI TEST PERSON A') : medical('NAVI TEST PERSON A'));
  const journey = await service.create(); assert.equal(journey.readiness, 35);
  let res = await service.request(`/journeys/${journey.id}/documents`, fileForm(customPdf('NAVI TEST PERSON A')), service.cookie);
  assert.equal(res.status, 200); assert.equal((await res.json()).journey.readiness, 70);
  const passbook = syntheticPdf(['SYNTHETIC BANK PASSBOOK - NOT VALID', 'Bank: NAVI TEST BANK', 'Holder: NAVI TEST PERSON A', 'Account: ****1234']);
  res = await service.request(`/journeys/${journey.id}/documents`, fileForm(passbook, 'application/pdf', 'bank.pdf', 'bank_passbook'), service.cookie);
  assert.equal(res.status, 200); const added = await res.json(); assert.equal(added.journey.readiness, 90);
  assert.equal(added.document.fields.accountLast4, '1234'); assert.equal(added.document.fields.accountNumber, undefined);
  res = await service.request(`/journeys/${journey.id}/review`, { confirmed: true }, service.cookie);
  assert.equal(res.status, 200); const reviewed = await res.json(); assert.equal(reviewed.readiness, 100); assert.equal(reviewed.currentStage, 'READY_TO_PROCEED');
  res = await service.request(`/journeys/${journey.id}/documents/${added.document.id}`, null, service.cookie, 'DELETE');
  assert.equal(res.status, 200); assert.equal((await res.json()).readiness, 70); assert.equal(service.requests.length, 2);
});

test('Arbitrary bytes still require matching extension, MIME and container before any AI call', async t => {
  const service = await controlled(t, () => assert.fail('Invalid input must not reach the model'));
  const journey = await service.create();
  for (const [bytes, mime, filename, code] of [
    [customPdf('NAVI TEST PERSON A'), 'application/pdf', 'hidden.exe', 'UNSUPPORTED_FILE_TYPE'],
    [customPdf('NAVI TEST PERSON A'), 'image/png', 'x.png', 'UNSUPPORTED_FILE_TYPE'],
    [Buffer.from('%PDF-1.4 broken'), 'application/pdf', 'x.pdf', 'DOCUMENT_INVALID'],
    [Buffer.from(syntheticImages['image/png'], 'base64').subarray(0, 25), 'image/png', 'x.png', 'DOCUMENT_INVALID'],
  ]) {
    const res = await service.request(`/journeys/${journey.id}/documents`, fileForm(bytes, mime, filename), service.cookie);
    assert.equal((await res.json()).error.code, code);
  }
  assert.equal(service.requests.length, 0);
});

test('Document transport errors do not retry or substitute sample fields', async t => {
  const service = await controlled(t, () => { throw new Error('SYNTHETIC-SENSITIVE-RAW-CONTENT'); });
  const journey = await service.create();
  const res = await service.request(`/journeys/${journey.id}/documents`, fileForm(customPdf('NAVI TEST PERSON A')), service.cookie);
  assert.equal(res.status, 502); const body = await res.text();
  assert.match(body, /AI_PROVIDER_ERROR/); assert.doesNotMatch(body, /SYNTHETIC-SENSITIVE|NAVI TEST PERSON/);
  assert.equal(service.requests.length, 1); assert.equal(res.headers.get('X-NAVI-AI-Mode'), 'live');
  const after = await (await service.request(`/journeys/${journey.id}`, null, service.cookie)).json();
  assert.equal(after.readiness, 35); assert.deepEqual(after.documents, []);
});

test('Document timeout leaves no verified evidence and never starts a second transport', async t => {
  const service = await controlled(t, async () => {
    await new Promise(resolve => setTimeout(resolve, 80));
    return medical('NAVI TEST PERSON A');
  }, { timeoutMs: 20 });
  const journey = await service.create();
  const res = await service.request(`/journeys/${journey.id}/documents`, fileForm(customPdf('NAVI TEST PERSON A')), service.cookie);
  assert.equal(res.status, 504); assert.equal((await res.json()).error.code, 'AI_TIMEOUT');
  assert.equal(service.requests.length, 1);
  await new Promise(resolve => setTimeout(resolve, 100));
  const after = await (await service.request(`/journeys/${journey.id}`, null, service.cookie)).json();
  assert.equal(after.readiness, 35); assert.deepEqual(after.documents, []);
});
