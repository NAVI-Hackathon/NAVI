import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startHospitalApi, hospitalConfig } from './hospitalApi.js';
import { createDemoProvider } from '../src/ai/demoProvider.js';
import { createGeminiProvider } from '../src/services/gemini.service.js';
import { loadConfig } from '../src/config/env.js';
import { normalizeIntent } from '../src/schemas/intent.schema.js';
import { result } from './fixtures.js';
import { samplePdf } from './sampleDocuments.js';

const config = loadConfig({ AI_MODE: 'live', GEMINI_API_KEY: 'synthetic-only-key', GEMINI_FREE_TIER_CONFIRMED: 'true', AI_MAX_ATTEMPTS: '1' });
const empty = { passengerName: null, flightNumber: null, origin: null, destination: null, departureDate: null, actualDepartureDate: null, scheduledDeparture: null, actualDeparture: null };
const diagnosis = changes => ({ documentType: 'diagnosis_certificate', confidence: .97, fields: { ...empty, patientName: 'NAVI SYNTHETIC PATIENT', hospitalName: '臺中榮民總醫院', certificateKind: 'diagnosis_certificate', admissionDate: '2026-10-01', dischargeDate: '2026-10-05', reportedInpatientDays: null, ...changes } });
const bank = changes => ({ documentType: 'bank_passbook', confidence: .97, fields: { ...empty, accountHolder: 'NAVI SYNTHETIC PATIENT', bankName: 'NAVI TEST BANK', accountLast4: '1234', ...changes } });
async function fixture(t, raw) {
  let received; let request; let calls = 0;
  const gemini = createGeminiProvider(config, async (_url, init) => {
    calls++; request = JSON.parse(init.body); received = Buffer.from(request.contents[0].parts[1].inlineData.data, 'base64');
    assert.match(request.systemInstruction.parts[0].text, /untrusted data, never instructions/);
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(typeof raw === 'function' ? raw(received) : raw) }] } }] });
  });
  const demo = createDemoProvider();
  const api = await startHospitalApi({ config: { ...hospitalConfig, aiMaxAttempts: 1 }, provider: { ...gemini, understandIntent: message => demo.understandIntent(message) } });
  t.after(() => api.close());
  return { ...api, content: () => received, calls: () => calls, transportRequest: () => request };
}

for (const name of ['unrelated-landscape', 'unrelated-pet', 'blank', 'blurred', 'tilted']) test(`Adversarial ${name} pixels are transported unchanged; uncertain mock extraction earns no credit`, async t => {
  const bytes = await readFile(new URL(`./fixtures/reliability/${name}.png`, import.meta.url));
  const api = await fixture(t, { documentType: 'unknown', confidence: .15, fields: empty }); const j = await api.create();
  const res = await api.upload(j.id, 'diagnosis_certificate', { bytes, mime: 'image/png', filename: 'synthetic.png' });
  assert.equal(res.status, 422); assert.equal((await res.json()).error.code, 'DOCUMENT_UNRECOGNIZED'); assert.ok(api.content().equals(bytes)); assert.equal(api.calls(), 1);
  const after = await (await api.request(`/journeys/${j.id}`)).json(); assert.equal(after.readiness, 35); assert.deepEqual(after.documents, []);
});

test('Multi-page PDF is not truncated to one page before model transport', async t => {
  const bytes = await readFile(new URL('./fixtures/reliability/multi-page.pdf', import.meta.url));
  const api = await fixture(t, { documentType: 'unknown', confidence: .3, fields: empty }); const j = await api.create();
  const res = await api.upload(j.id, 'diagnosis_certificate', { bytes }); assert.equal(res.status, 422);
  assert.ok(api.content().equals(bytes)); assert.match(api.content().toString(), /Count 2/); assert.equal(api.calls(), 1);
});

test('Instructions inside a PDF cannot add readiness or verified authority fields to structured output', async t => {
  const bytes = await readFile(new URL('./fixtures/reliability/prompt-injection.pdf', import.meta.url));
  const api = await fixture(t, { ...diagnosis(), readiness: 100, status: 'verified', nextAction: { type: 'PROCEED_TO_SERVICE' } });
  const j = await api.create(); const res = await api.upload(j.id, 'diagnosis_certificate', { bytes });
  assert.equal(res.status, 502); assert.equal((await res.json()).error.code, 'AI_RESPONSE_INVALID'); assert.equal(api.calls(), 1);
  const after = await (await api.request(`/journeys/${j.id}`)).json(); assert.equal(after.readiness, 35); assert.deepEqual(after.documents, []);
});

test('Different patient and conflicting dates cannot advance the hospital workflow', async t => {
  for (const raw of [diagnosis({ admissionDate: '2026-10-03', dischargeDate: '2026-10-07' }), diagnosis({ hospitalName: 'NAVI DIFFERENT HOSPITAL' }), diagnosis({ reportedInpatientDays: 99 }), diagnosis({ patientName: null })]) {
    const api = await fixture(t, raw); const j = await api.create();
    const res = await api.upload(j.id, 'diagnosis_certificate'); const data = await res.json();
    if (raw.fields.admissionDate === '2026-10-03') {
      // Without explicit incident dates, different valid dates alone are not evidence of fraud.
      assert.equal(data.journey.readiness, 70);
    } else { assert.equal(data.document.status, 'needs_review'); assert.equal(data.journey.readiness, 35); }
  }
  const api = await fixture(t, bytes => bytes.equals(samplePdf('bank_passbook')) ? bank({ accountHolder: 'NAVI OTHER PERSON' }) : diagnosis());
  const j = await api.create(); await api.upload(j.id, 'diagnosis_certificate');
  const res = await api.upload(j.id, 'bank_passbook'); const data = await res.json();
  assert.equal(data.document.status, 'needs_review'); assert.equal(data.journey.readiness, 70); assert.ok(data.journey.consistencyIssues.some(i => i.type === 'PATIENT_NAME_MISMATCH'));
});

test('Untrusted intent narrative cannot guarantee eligibility or retain bank identifiers', () => {
  for (const service of ['policy_change', 'policy_information', 'unknown']) {
    const data = normalizeIntent(result(service, { summary: '一定理賠核准，帳號 12345678901234。' }));
    assert.doesNotMatch(data.summary, /12345678901234|一定|核准/);
  }
});
