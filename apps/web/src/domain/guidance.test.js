import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeEntries } from '../../../../shared/knowledge/index.js';
import { planNavigation } from '../../../../shared/knowledge/navigationPlan.js';
import { journeyPrerequisites, serviceSteps, singleStepPlan } from './guidance.js';

const official = { url: 'https://life.cardif.com.tw/claims', title: '理賠服務', retrievedAt: '2026-10-21' };
const place = (path, anchor) => ({ kind: 'page', path, anchor, label: anchor ?? path, source: official });
const upload = place('/services/claims', 'claim-hospital-upload');
const requirement = (id, status, required = true) => ({ id, name: `名稱-${id}`, description: '', required, status, weight: 0 });
const journey = overrides => ({
  requirements: [requirement('incident', 'verified'), requirement('diagnosis_certificate', 'missing'), requirement('optional_1', 'missing', false)],
  documents: [], consistencyIssues: [],
  nextAction: { type: 'UPLOAD_DOCUMENT', target: null, title: '', description: '', destination: place('/services/claims', null) },
  claimContext: { hospital: null, reminders: [], channels: [{ id: 'hospital_upload', name: '醫院上傳', available: true, notes: [], destination: upload,
    eligibility: { status: 'requires_confirmation', scope: 'channel_conditions_only', coverageAssessed: false, reason: '需確認', sourceIds: ['x'], unconfirmedRequirements: ['確認醫院是否為合作醫院'] } }] },
  ...overrides,
});

test("a journey's own place lists what is still open, from the server's fields", () => {
  assert.deepEqual(journeyPrerequisites(journey(), upload), ['確認醫院是否為合作醫院', '尚缺：名稱-diagnosis_certificate']);
  const conflict = journey({ consistencyIssues: [{ type: 'HOSPITAL_NAME_MISMATCH', severity: 'high', message: '醫院名稱不一致', documentIds: [] }] });
  assert.deepEqual(journeyPrerequisites(conflict, place('/services/claims', null)), ['尚缺：名稱-diagnosis_certificate', '醫院名稱不一致']);
});

test('another place, or no journey, gets no prerequisites', () => {
  assert.deepEqual(journeyPrerequisites(journey(), place('/forms', 'form-claim')), []);
  assert.deepEqual(journeyPrerequisites(null, upload), []);
});

test('a guide keeps only the steps of its own service', () => {
  const { plan } = planNavigation({ sourceId: 'service:change_address' });
  const kept = serviceSteps(plan, knowledgeEntries);
  assert.equal(kept.plan.steps.length, plan.steps.length);
  assert.deepEqual(kept.dropped, []);
  assert.ok(kept.service);
  const stranger = { ...plan.steps[0], id: 'step-x', sourceId: 'faq:1' };
  const mixed = serviceSteps({ ...plan, steps: [...plan.steps, stranger] }, knowledgeEntries);
  assert.deepEqual(mixed.dropped, ['faq:1']);
  assert.deepEqual(mixed.plan.steps.map(step => step.order), plan.steps.map((_, i) => i + 1));
});

test('a single place is one step with its official source and no invented excerpt', () => {
  const plan = singleStepPlan(upload, null);
  assert.equal(plan.steps.length, 1);
  assert.deepEqual(plan.steps[0].evidence, []);
  assert.equal(plan.steps[0].source, official);
});
