import test from 'node:test';
import assert from 'node:assert/strict';
import { hospitalFacts, hospitalLabel, hospitalStep, partnerLabel } from './journeyFacts.js';
import { createMockAdapter } from '../services/adapters.js';
import { hospitalClaimContext } from '../../../../shared/hospitalization.js';

// NAVI-006: what the workspace says about the hospital follows the journey as it is now.
const memoryStorage = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }; };
const demo = () => createMockAdapter({ storage: memoryStorage(), analysisDelayMs: 0, documentDelayMs: 0 });
const manual = hospitalName => ({ patientName: '王小明', hospitalName, admissionDate: '2026-09-28', dischargeDate: '2026-10-02', diagnosis: '示範' });

test('demo: unknown → certificate → replaced → removed, every statement follows', async () => {
  const service = demo();
  const { snapshot: start } = await service.analyze('我住院了，想申請理賠');
  assert.equal(hospitalFacts(start.journey).name, null);
  assert.equal(hospitalLabel(hospitalFacts(start.journey)), '待確認');
  assert.equal(hospitalStep(start.journey).done, false);
  assert.match(hospitalStep(start.journey).text, /還不知道住院的醫院/);

  const uploaded = (await service.uploadDocument('diagnosis_certificate', { sample: true })).journey;
  const facts = hospitalFacts(uploaded);
  assert.deepEqual([facts.name, facts.source, facts.listed], ['臺中榮民總醫院', 'certificate', true]);
  assert.equal(hospitalLabel(facts), '臺中榮民總醫院（來自診斷書）');
  assert.equal(partnerLabel(facts), '合作名單內・資格待確認', 'on the list is not eligibility');
  assert.ok(facts.toConfirm.length > 0, 'the conditions still to confirm are named');
  assert.equal(hospitalStep(uploaded).done, true);
  assert.doesNotMatch(hospitalStep(uploaded).text, /還不知道/);
  assert.match(hospitalStep(uploaded).text, /依診斷書.*臺中榮民總醫院.*仍需確認，請留意：/);

  const replaced = service.submitManual('diagnosis_certificate', manual('長庚醫院')).journey;
  assert.deepEqual([hospitalFacts(replaced).name, hospitalFacts(replaced).listed], ['長庚醫院', false]);
  assert.equal(partnerLabel(hospitalFacts(replaced)), '未對應合作院所');
  assert.deepEqual(hospitalFacts(replaced).toConfirm, []);

  const removed = service.removeDocument('diagnosis_certificate').journey;
  assert.equal(hospitalFacts(removed).name, null);
  assert.equal(hospitalStep(removed).done, false);
});

test('demo: the description names the hospital until a certificate names another', async () => {
  const service = demo();
  const { snapshot } = await service.analyze('我在長庚醫院住院三天，想申請理賠');
  assert.equal(hospitalLabel(hospitalFacts(snapshot.journey)), '長庚醫院（來自你的描述）');
  const uploaded = (await service.uploadDocument('diagnosis_certificate', { sample: true })).journey;
  assert.equal(hospitalLabel(hospitalFacts(uploaded)), '臺中榮民總醫院（來自診斷書）');
});

test('formal journey: the server context and its own list of conditions to confirm', () => {
  const certificate = { documentType: 'diagnosis_certificate', status: 'verified', fields: { hospitalName: '臺中榮民總醫院' } };
  const journey = documents => ({ documents, claimContext: hospitalClaimContext({ hospitalName: null }, documents) });
  assert.equal(hospitalFacts(journey([])).name, null);
  const facts = hospitalFacts(journey([certificate]));
  assert.deepEqual([facts.name, facts.source, facts.eligibility], ['臺中榮民總醫院', 'certificate', 'requires_confirmation']);
  const server = journey([certificate]).claimContext.channels.find(c => c.id === 'hospital_upload').eligibility.unconfirmedRequirements;
  assert.deepEqual(facts.toConfirm, server);
  // A document still to be reviewed is not a source.
  assert.equal(hospitalFacts(journey([{ ...certificate, status: 'needs_review' }])).name, null);
});
