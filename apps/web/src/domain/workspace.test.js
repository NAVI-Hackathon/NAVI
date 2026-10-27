import test from 'node:test';
import assert from 'node:assert/strict';
import { documentTypesOf, officialSourcesOf, openConditions, requirementGroups, stageLabel, workspaceProfile } from './workspace.js';

const uuid = n => `00000000-0000-4000-8000-00000000000${n}`;
const requirement = (id, status, required = true) => ({ id, name: id, description: '', required, status, weight: 0 });
const official = { url: 'https://life.cardif.com.tw/claims', title: '理賠服務', retrievedAt: '2026-10-21' };
function journey(overrides = {}) {
  return {
    id: uuid(1), title: '住院醫療理賠', summary: '住院五天，詢問理賠。', supported: true, currentStage: 'EVIDENCE_COLLECTION',
    requirements: [requirement('incident', 'verified'), requirement('diagnosis_certificate', 'missing'), requirement('bank_passbook', 'missing'), requirement('optional_1', 'missing', false)],
    documents: [], consistencyIssues: [], sources: [], ...overrides,
  };
}
const snapshot = (kind, overrides) => ({ journey: journey(overrides), context: { kind } });

test('the document workflow gets the full workspace; other services and specialist review get the compact one', () => {
  assert.equal(workspaceProfile(snapshot('hospital')), 'full');
  assert.equal(workspaceProfile(snapshot('hospital', { currentStage: 'HUMAN_REVIEW' })), 'compact');
  assert.equal(workspaceProfile(snapshot('payment_method_change', { supported: false, currentStage: 'SERVICE_IDENTIFIED' })), 'compact');
  assert.equal(workspaceProfile(snapshot('unknown')), 'compact');
});

test('document slots follow the journey requirements, not a fixed list', () => {
  assert.deepEqual(documentTypesOf(journey()), ['diagnosis_certificate', 'bank_passbook']);
  assert.deepEqual(documentTypesOf(journey({ requirements: [requirement('incident', 'verified')] })), []);
});

test('open conditions quote the server state: conflicts, documents to re-check after a correction, fields to review', () => {
  const documents = [
    { id: uuid(2), documentType: 'diagnosis_certificate', filename: 'a.pdf', status: 'needs_review', requiresRevalidation: true },
    { id: uuid(3), documentType: 'bank_passbook', filename: 'b.pdf', status: 'needs_review' },
    { id: uuid(4), documentType: 'bank_passbook', filename: 'c.pdf', status: 'verified' },
  ];
  const conditions = openConditions(journey({ documents, consistencyIssues: [{ type: 'HOSPITAL_NAME_MISMATCH', severity: 'high', message: '兩份文件的醫院名稱不一致。', documentIds: [uuid(2)] }] }));
  assert.deepEqual(conditions.map(c => c.id), ['issue-HOSPITAL_NAME_MISMATCH', `revalidate-${uuid(2)}`, `review-${uuid(3)}`]);
  assert.match(conditions[1].text, /重新上傳確認/);
  assert.deepEqual(openConditions(journey()), []);
});

test('requirements split into done / still needed / depends on the case', () => {
  const groups = requirementGroups(journey());
  assert.deepEqual(groups.done.map(r => r.id), ['incident']);
  assert.deepEqual(groups.pending.map(r => r.id), ['diagnosis_certificate', 'bank_passbook']);
  assert.deepEqual(groups.optional.map(r => r.id), ['optional_1']);
});

test('stage wording carries no score', () => {
  assert.equal(stageLabel(journey({ currentStage: 'READY_TO_PROCEED' })), '資料初步準備完成');
  assert.equal(stageLabel(journey({ currentStage: 'INCIDENT_IDENTIFIED' })), '旅程已建立');
});

test('official sources: snapshot entries first, plain pages deduplicated, prototype guides left out', () => {
  const sources = [
    { id: 'claim-doc:2', sourceId: 'claim-doc:2', title: '住院醫療', url: official.url, retrievedAt: '2026-10-21', isMock: false },
    { id: 'guide', title: '原型說明', url: null, isMock: true },
  ];
  const out = officialSourcesOf(journey({ sources, officialSources: [official, { ...official, url: 'https://life.cardif.com.tw/forms' }] }));
  assert.deepEqual(out.map(s => s.key), ['claim-doc:2', 'https://life.cardif.com.tw/forms']);
  assert.equal(out[0].sourceId, 'claim-doc:2');
  assert.equal(out[1].sourceId, null);
});
