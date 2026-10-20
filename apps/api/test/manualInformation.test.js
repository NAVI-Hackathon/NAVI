import test from 'node:test';
import assert from 'node:assert/strict';
import { startHospitalApi } from './hospitalApi.js';
import { ServiceJourneySchema } from '../../../shared/journey.js';

const diagnosis = { documentType: 'diagnosis_certificate', fields: { hospitalName: '台中榮總', admissionDate: '2026-10-01', dischargeDate: '2026-10-05' } };
const bank = { documentType: 'bank_passbook', fields: { bankName: 'NAVI 合成銀行', accountLast4: '1234' } };
test('manual information stays separate, unverified and cannot unlock review or readiness', async t => {
  const api = await startHospitalApi(); t.after(api.close);
  const original = await api.create();
  for (const input of [diagnosis, bank]) {
    const response = await api.request(`/journeys/${original.id}/manual-document-information`, input);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.information.source, 'manual'); assert.equal(result.information.status, 'needs_review');
    assert.deepEqual(result.readinessChange, { before: 35, after: 35 });
    assert.deepEqual(result.journey.documents, []); assert.equal(result.journey.currentStage, 'EVIDENCE_COLLECTION');
    assert.equal(result.journey.nextAction.type, 'UPLOAD_DOCUMENT'); ServiceJourneySchema.parse(result.journey);
  }
  const restored = await (await api.request(`/journeys/${original.id}`)).json();
  assert.equal(restored.manualDocumentInformation.length, 2);
  assert.equal((await api.request(`/journeys/${original.id}/review`, { confirmed: true })).status, 409);
  assert.deepEqual(restored.extractedData, original.extractedData);
});
test('verified evidence supersedes matching manual data, retaining the 35→70→90→100 rules', async t => {
  const api = await startHospitalApi(); t.after(api.close); const journey = await api.create();
  await api.request(`/journeys/${journey.id}/manual-document-information`, diagnosis);
  await api.request(`/journeys/${journey.id}/manual-document-information`, bank);
  const first = await (await api.upload(journey.id, 'diagnosis_certificate')).json();
  assert.equal(first.journey.readiness, 70); assert.deepEqual(first.journey.manualDocumentInformation.map(i => i.documentType), ['bank_passbook']);
  const second = await (await api.upload(journey.id, 'bank_passbook')).json();
  assert.equal(second.journey.readiness, 90); assert.deepEqual(second.journey.manualDocumentInformation, []);
  const reviewed = await (await api.request(`/journeys/${journey.id}/review`, { confirmed: true })).json(); assert.equal(reviewed.readiness, 100);
  const removed = await (await api.request(`/journeys/${journey.id}/documents/${second.document.id}`, undefined, 'DELETE')).json(); assert.equal(removed.readiness, 70);
  const manual = await (await api.request(`/journeys/${journey.id}/manual-document-information`, bank)).json(); assert.equal(manual.journey.readiness, 70);
});
test('manual data cannot forge verification, pass full bank numbers or retain clinical descriptions', async t => {
  const api = await startHospitalApi(); t.after(api.close); const journey = await api.create();
  for (const input of [{ ...bank, source: 'live' }, { ...bank, status: 'verified' }, { ...bank, confidence: 1 }, { ...bank, readiness: 100 }, { ...bank, fields: { bankName: 'NAVI', accountNumber: '123456789012' } }, { ...bank, fields: { accountLast4: '1234567890' } }, { ...diagnosis, fields: { diagnosis: 'not retained' } }, { ...diagnosis, fields: {} }, { ...diagnosis, fields: { admissionDate: '2026-02-30' } }]) {
    assert.equal((await api.request(`/journeys/${journey.id}/manual-document-information`, input)).status, 400);
  }
  assert.equal((await (await api.request(`/journeys/${journey.id}`)).json()).manualDocumentInformation, undefined);
});
test('manual entries replace by type, can be removed, and preserve existing documents', async t => {
  const api = await startHospitalApi(); t.after(api.close); const journey = await api.create();
  await api.upload(journey.id, 'diagnosis_certificate');
  for (let i = 0; i < 3; i++) await api.request(`/journeys/${journey.id}/manual-document-information`, bank);
  const current = await (await api.request(`/journeys/${journey.id}`)).json();
  assert.equal(current.manualDocumentInformation.length, 1); assert.equal(current.documents.length, 1); assert.equal(current.readiness, 70);
  const removed = await (await api.request(`/journeys/${journey.id}/manual-document-information/bank_passbook`, undefined, 'DELETE')).json();
  assert.deepEqual(removed.manualDocumentInformation, []); assert.equal(removed.readiness, 70);
  assert.equal((await api.request(`/journeys/${journey.id}/manual-document-information/bank_passbook`, undefined, 'DELETE')).status, 404);
});
test('manual endpoint rejects expired, unsupported and low-confidence journeys with the existing error contract', async t => {
  const api = await startHospitalApi(); t.after(api.close);
  const missing = await api.request('/journeys/00000000-0000-4000-8000-000000000000/manual-document-information', bank);
  assert.equal(missing.status, 404); assert.equal((await missing.json()).error.code, 'JOURNEY_NOT_FOUND');
  const unsupported = await api.create({ message: '我要更改繳費方式' });
  const response = await api.request(`/journeys/${unsupported.id}/manual-document-information`, bank);
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'SERVICE_NOT_SUPPORTED');
  const base = await api.create();
  const low = await api.create({ message: '我住院要申請理賠', intentResult: { intent: 'service_request', serviceType: 'hospitalization_claim', confidence: 0.2, summary: '合成低信心案例', extractedData: base.extractedData } });
  const blocked = await api.request(`/journeys/${low.id}/manual-document-information`, bank);
  assert.equal(blocked.status, 409); assert.equal((await blocked.json()).error.code, 'HUMAN_REVIEW_REQUIRED');
});
