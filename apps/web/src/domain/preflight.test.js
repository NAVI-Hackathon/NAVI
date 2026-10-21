import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreflight, localCriteria, localHandoffSummary } from './preflight.js';

const requirement = (id, name, status, required = true) => ({ id, name, description: `${name}說明`, required, status, weight: 10 });
const uuid = n => `00000000-0000-4000-8000-00000000000${n}`;
function journey(overrides = {}) {
  return {
    id: uuid(9), updatedAt: '2026-10-21T00:00:00.000Z', supported: true, title: '住院醫療理賠', summary: '住院五天，詢問理賠。',
    requirements: [
      requirement('incident', '事件資訊', 'verified'), requirement('service', '服務辨識', 'verified'),
      requirement('diagnosis_certificate', '診斷書或住院證明', 'missing'), requirement('inpatient_info', '住院資訊', 'missing'),
      requirement('bank_passbook', '存摺影本', 'missing'), requirement('confirmation', '資料確認', 'missing'),
      requirement('optional_1', '病理報告（依病況）', 'missing', false),
    ],
    documents: [], consistencyIssues: [], nextAction: { type: 'UPLOAD_DOCUMENT', target: 'diagnosis_certificate' },
    claimContext: { hospital: { mentioned: '台中榮總', matchedName: '臺中榮民總醫院', partner: true }, inpatient: { days: 5 } },
    ...overrides,
  };
}
const ids = items => items.map(item => item.id);

test('35%: what NAVI has, what to upload, and the stay info explained by the missing certificate', () => {
  const board = buildPreflight(journey());
  assert.deepEqual(ids(board.obtained), ['incident', 'service']);
  assert.match(board.obtained[1].detail, /臺中榮民總醫院/);
  assert.deepEqual(ids(board.missing), ['diagnosis_certificate', 'inpatient_info', 'bank_passbook', 'confirmation']);
  assert.deepEqual(board.missing[0].action, { type: 'upload', target: 'diagnosis_certificate', label: '上傳文件' });
  assert.equal(board.missing.at(-1).action, null, 'confirmation is not offered before the documents are in');
  assert.deepEqual(board.review, []);
  assert.deepEqual(ids(board.optional), ['optional_1']);
});

test('a flagged certificate moves to 需要人工確認 with the server message as the reason', () => {
  const certificate = { id: uuid(1), documentType: 'diagnosis_certificate', status: 'needs_review', fields: { patientName: '陳恩如', hospitalName: '臺中榮民總醫院', admissionDate: null, dischargeDate: null } };
  const board = buildPreflight(journey({
    requirements: journey().requirements.map(r => (r.id === 'diagnosis_certificate' ? { ...r, status: 'needs_review' } : r)),
    documents: [certificate],
    consistencyIssues: [{ type: 'HOSPITAL_NAME_MISMATCH', severity: 'high', message: '診斷書醫院與描述不一致', documentIds: [uuid(1)] }],
  }));
  assert.deepEqual(ids(board.review), ['diagnosis_certificate']);
  assert.deepEqual(board.review[0].reasons, ['診斷書醫院與描述不一致']);
  assert.match(board.missing.find(item => item.id === 'inpatient_info').detail, /確認後，才會整理住院資訊/);
  assert.equal(board.review.length, 1, 'the issue is not listed twice');
});

test('without a consistency issue the reason names the empty fields', () => {
  const certificate = { id: uuid(2), documentType: 'diagnosis_certificate', status: 'needs_review', fields: { patientName: null, hospitalName: '臺中榮民總醫院', admissionDate: '2026-09-28', dischargeDate: null } };
  const board = buildPreflight(journey({
    requirements: journey().requirements.map(r => (r.id === 'diagnosis_certificate' ? { ...r, status: 'needs_review' } : r)),
    documents: [certificate],
  }));
  assert.deepEqual(board.review[0].reasons, ['文件上找不到：病患姓名、出院日期']);
});

test('typed information is 待確認 (MANUAL_UNVERIFIED) and listed once', () => {
  const manual = [{ documentType: 'bank_passbook', source: 'manual', status: 'needs_review', fields: { bankName: '示範銀行' }, updatedAt: '2026-10-21T00:00:00.000Z' }];
  const board = buildPreflight(journey({ manualDocumentInformation: manual }));
  assert.deepEqual(ids(board.review), ['bank_passbook']);
  assert.match(board.review[0].title, /你提供的資訊/);
  assert.ok(!ids(board.missing).includes('bank_passbook'));
});

test('the server explanation decides the groups when it matches the journey version', () => {
  const j = journey();
  const criteria = localCriteria(j).map(c => (c.id === 'bank_passbook' ? { ...c, reasonCode: 'DOCUMENT_NEEDS_REVIEW' } : c));
  const explanation = { journeyId: j.id, journeyUpdatedAt: j.updatedAt, criteria };
  assert.ok(ids(buildPreflight(j, { explanation }).review).includes('bank_passbook'));
  const stale = { ...explanation, journeyUpdatedAt: '2026-10-20T00:00:00.000Z' };
  assert.ok(!ids(buildPreflight(j, { explanation: stale }).review).includes('bank_passbook'), 'an older explanation is ignored');
  assert.deepEqual(buildPreflight(j).obtained.map(item => item.earned), [10, 10]);
});

test('ready for review offers 確認資料; the /demo handoff summary matches the server allowlisted shape', () => {
  const j = journey({ nextAction: { type: 'REVIEW_INFORMATION', target: null } });
  assert.deepEqual(buildPreflight(j).missing.at(-1).action, { type: 'review' });
  const summary = localHandoffSummary(j);
  assert.deepEqual(Object.keys(summary).sort(), ['collected', 'concerns', 'disclaimer', 'issue', 'missing', 'provider', 'reason', 'redacted', 'sources']);
  assert.deepEqual(summary.collected, ['事件資訊', '服務辨識']);
  assert.ok(!JSON.stringify(summary).includes('住院五天'), 'no free-text description');
  assert.ok(!summary.missing.includes('病理報告（依病況）'));
});
