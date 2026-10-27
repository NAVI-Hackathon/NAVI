import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { loadHoldout, runMock, fixtureBytes } from '../eval/holdout/run.js';
import { scoreObservations } from '../eval/holdout/score.js';
import { offlineNetworkStats } from './networkGuard.js';

const sha = '0'.repeat(40);
const intent = { id: 'I', kind: 'intent', category: 'unknown', groundTruth: { tasks: [{ serviceType: 'unknown', outcome: 'clarification' }] } };
const doc = { id: 'D', kind: 'document', category: 'incomplete', groundTruth: { documentType: 'diagnosis_certificate', fields: { patientName: 'SYNTHETIC A', hospitalName: null }, status: 'needs_review', issues: [] } };
const observation = (id, data = {}) => ({ id, mode: 'mock_transport', provider: 'gemini', model: 'synthetic-test-model', gitSha: sha,
  timestamp: '2026-10-27T00:00:00Z', latencyMs: 10, requests: 1, tokenUsage: null, fallbackUsed: false, errorCode: null, ...data });

test('Frozen prospective dataset runs all authored mock outputs through actual provider and validators with zero external requests', async () => {
  const { cases, manifest } = await loadHoldout();
  assert.equal(manifest.independentHeldOut, false); assert.equal(cases.length, 36);
  const results = await runMock(cases, sha); const score = scoreObservations(cases, results);
  assert.equal(score.pass.numerator, 35);
  assert.deepEqual(score.rows.filter(row => !row.pass).map(row => row.id), ['H17']);
  // Frozen H17 expects human review; the existing conservative negation guard asks for clarification.
  assert.equal(results.find(row => row.id === 'H17').tasks[0].outcome, 'clarification');
  assert.equal(score.requests, 35); assert.equal(results.find(row => row.id === 'D11').requests, 0);
  assert.deepEqual(offlineNetworkStats(), { blockedExternalAttempts: 0, externalRequests: 0 });
});
test('Scorer counts unknown errors, wrong service and timeouts as failures rather than discarding them', () => {
  for (const data of [{ tasks: [{ serviceType: 'hospitalization_claim', outcome: 'supported' }] }, { errorCode: 'AI_TIMEOUT' }, { errorCode: 'AI_PROVIDER_ERROR' }]) {
    const report = scoreObservations([intent], [observation('I', data)]);
    assert.equal(report.intent.exactTasks.value, 0); assert.equal(report.intent.unknownHandling.value, 0);
    assert.equal(report.intent.perClass.unknown.recall.value, 0);
    assert.equal(report.intent.timeoutRate.value, data.errorCode === 'AI_TIMEOUT' ? 1 : 0);
    assert.equal(report.intent.apiErrorRate.value, data.errorCode ? 1 : 0);
  }
});
test('Scorer penalizes hallucinated and omitted fields; null ground truth is not a correct extracted fact', () => {
  const report = scoreObservations([doc], [observation('D', { extraction: { documentType: 'diagnosis_certificate', fields: { patientName: 'WRONG', hospitalName: 'INVENTED', diagnosis: 'INVENTED' } }, documentStatus: 'verified' })]);
  assert.equal(report.document.fields.tp, 0); assert.equal(report.document.fields.fp, 3); assert.equal(report.document.fields.fn, 1);
  assert.equal(report.document.fields.f1.value, 0); assert.equal(report.document.incompleteRefusal.value, 0); assert.equal(report.pass.value, 0);
});
test('Scorer preserves meaningful F1, multi-intent confusion, missing observations and absent denominators', () => {
  const multi = { ...intent, id: 'M', groundTruth: { tasks: [{ serviceType: 'policy_change', outcome: 'preview' }, { serviceType: 'hospitalization_claim', outcome: 'supported' }] } };
  const rows = [observation('M', { tasks: [...multi.groundTruth.tasks].reverse() }), observation('D', { extraction: { documentType: 'diagnosis_certificate', fields: { patientName: 'SYNTHETIC A' } }, documentStatus: 'needs_review' })];
  const score = scoreObservations([intent, multi, doc], rows);
  assert.deepEqual(score.notRunIds, ['I']); assert.equal(score.pass.value, 1); assert.equal(score.document.fields.f1.value, 1);
  assert.equal(score.intent.confusion['hospitalization_claim+policy_change']['hospitalization_claim+policy_change'], 1);
  assert.equal(score.intent.unknownHandling.value, null); assert.equal(score.document.irrelevantFalseAccept.value, null);
  assert.equal(scoreObservations([intent], []).intent.exactTasks.value, null);
});
test('Scorer refuses duplicate, unknown, mixed version/provider evidence and fallback claims', () => {
  const good = observation('I', { tasks: intent.groundTruth.tasks });
  for (const rows of [[good, good], [{ ...good, id: 'unlisted' }], [good, { ...good, id: 'D', mode: 'live_gemini' }], [good, { ...good, id: 'D', gitSha: '1'.repeat(40) }], [{ ...good, fallbackUsed: true }], [{ ...good, requests: 2 }]]) assert.throws(() => scoreObservations([intent, doc], rows));
});
test('Irrelevant false acceptance and conflict handling reflect unsafe outputs, not just valid JSON', () => {
  const badPhoto = { ...doc, category: 'unrelated', groundTruth: { ...doc.groundTruth, documentType: 'unknown', status: 'rejected', errorCodes: ['DOCUMENT_UNRECOGNIZED'] } };
  const conflict = { ...doc, id: 'C', groundTruth: { ...doc.groundTruth, issues: ['PATIENT_NAME_MISMATCH'] } };
  const data = { extraction: { documentType: 'diagnosis_certificate', fields: doc.groundTruth.fields }, documentStatus: 'verified' };
  const report = scoreObservations([badPhoto, conflict], [observation('D', data), observation('C', data)]);
  assert.equal(report.document.irrelevantFalseAccept.value, 1); assert.equal(report.document.consistencyHandling.value, 0);
});
test('Dry Run has no live option, no secrets, exact proposed request cost and distinct input bytes', async () => {
  const output = execFileSync(process.execPath, ['--import', './apps/api/test/networkGuard.js', 'apps/api/eval/holdout/run.js', '--dry-run'], { cwd: new URL('../../../', import.meta.url), encoding: 'utf8' });
  const report = JSON.parse(output); assert.equal(report.liveGeminiRequests, 0); assert.equal(report.proposedMinimum.maximumGenerationsIncludingRetries, 6);
  assert.equal(report.fullDatasetMaximumRequests, 35); assert.equal(report.proposedMinimum.retryCount, 0);
  assert.notEqual(report.fixtures.D01.sha256, report.fixtures.D02.sha256);
  await assert.rejects(fixtureBytes({ existing: '../../../../.env' }));
  assert.throws(() => execFileSync(process.execPath, ['apps/api/eval/holdout/run.js', '--live'], { cwd: new URL('../../../', import.meta.url), stdio: 'pipe' }));
});
