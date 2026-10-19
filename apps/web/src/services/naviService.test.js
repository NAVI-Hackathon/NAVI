import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAdapter } from './adapters.js';
import { DEMO_STORY } from '../mocks/hospitalClaim.js';
import { ServiceJourneySchema } from '../../../../shared/journey.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
}
const fast = storage => createMockAdapter({ storage, analysisDelayMs: 0, documentDelayMs: 0 });

test('Golden Path 住院醫療理賠: 35 → 70 → 90 → 100 with contract-valid journeys', async () => {
  const service = fast(memoryStorage());
  const { snapshot } = await service.analyze(DEMO_STORY);
  const { journey } = snapshot;
  assert.equal(journey.serviceType, 'hospitalization_claim');
  assert.equal(journey.readiness, 35);
  assert.equal(journey.currentStage, 'EVIDENCE_COLLECTION');
  assert.equal(journey.nextAction.target, 'diagnosis_certificate');
  assert.equal(journey.claimContext.hospital.matchedName, '臺中榮民總醫院');
  assert.equal(journey.claimContext.channels.find(c => c.id === 'hospital_upload').available, true);

  const afterCertificate = await service.uploadDocument('diagnosis_certificate', { sample: true });
  assert.equal(afterCertificate.journey.readiness, 70);
  assert.equal(afterCertificate.journey.nextAction.target, 'bank_passbook');

  const afterPassbook = await service.uploadDocument('bank_passbook', { sample: true });
  assert.equal(afterPassbook.journey.readiness, 90);
  assert.equal(afterPassbook.journey.nextAction.type, 'REVIEW_INFORMATION');
  assert.equal(afterPassbook.journey.currentStage, 'READY_FOR_REVIEW');

  const done = service.confirm();
  assert.equal(done.journey.readiness, 100);
  assert.equal(done.journey.currentStage, 'READY_TO_PROCEED');
  assert.equal(done.journey.nextAction.type, 'PROCEED_TO_SERVICE');
  assert.equal(done.journey.nextAction.target, 'hospital_upload');
  ServiceJourneySchema.parse(done.journey);
});

test('a non-partner hospital routes to 理賠聯盟鏈 instead of 醫起通', async () => {
  const service = fast(memoryStorage());
  const { snapshot } = await service.analyze('我在長庚醫院住院三天，想申請理賠');
  assert.equal(snapshot.journey.claimContext.hospital.partner, false);
  assert.equal(snapshot.journey.claimContext.channels.find(c => c.id === 'hospital_upload').available, false);
  await service.uploadDocument('diagnosis_certificate', { sample: true });
  await service.uploadDocument('bank_passbook', { sample: true });
  assert.equal(service.confirm().journey.nextAction.target, 'union_chain');
});

test('the demo session masks identifiers before the description is stored', async () => {
  const storage = memoryStorage();
  const { snapshot } = await fast(storage).analyze('我在台中榮總住院五天，電話 0912345678，信箱 me@example.com，要怎麼申請理賠？');
  const stored = storage.getItem('navi.demo.journey');
  for (const secret of ['0912345678', 'me@example.com']) assert.ok(!stored.includes(secret), secret);
  assert.match(snapshot.context.story, /\[已遮蔽電話\].*\[已遮蔽電子郵件\]/);
  assert.equal(snapshot.journey.claimContext.hospital.matchedName, '臺中榮民總醫院');
});

test('hospital matching is conservative: 「榮總」 alone is not a partner, named campuses and abbreviations are', async () => {
  const hospitalFor = async story => (await fast(memoryStorage()).analyze(story)).snapshot.journey.claimContext.hospital;
  assert.deepEqual(await hospitalFor('我上週在榮總住院五天，要怎麼申請理賠？'), { mentioned: '榮總', matchedName: null, partner: false });
  assert.equal((await hospitalFor('我上週在台中榮總住院五天，要怎麼申請理賠？')).matchedName, '臺中榮民總醫院');
  assert.equal((await hospitalFor('我在中榮住院三天，想申請理賠')).matchedName, '臺中榮民總醫院');
});

test('outpatient-only visits do not open the 住院 journey', async () => {
  for (const story of ['我只有門診開刀，沒有住院，要怎麼申請理賠？', '我沒住院，只是去門診看病，可以申請理賠嗎', '我上週門診做了小手術']) {
    const result = await fast(memoryStorage()).analyze(story);
    assert.equal(result.snapshot, null, story);
    assert.notEqual(result.understanding.data.serviceType, 'hospitalization_claim', story);
  }
});

test('recognition failure leaves the journey unchanged and can be retried', async () => {
  const service = fast(memoryStorage());
  await service.analyze(DEMO_STORY);
  service.setFailNextDocument(true);
  await assert.rejects(service.uploadDocument('diagnosis_certificate', { sample: true }), { code: 'DOCUMENT_RECOGNITION_FAILED' });
  assert.equal(service.restore().journey.readiness, 35);
  assert.equal((await service.uploadDocument('diagnosis_certificate', { sample: true })).journey.readiness, 70);
});

test('manual entry counts as evidence, is validated and survives a reload', async () => {
  const storage = memoryStorage();
  const service = fast(storage);
  await service.analyze(DEMO_STORY);
  assert.throws(() => service.submitManual('diagnosis_certificate', { patientName: '王', hospitalName: '臺中榮民總醫院', admissionDate: '2026-10-02', dischargeDate: '2026-09-28', diagnosis: '示範' }));
  const snapshot = service.submitManual('diagnosis_certificate', { patientName: '王小明', hospitalName: '臺中榮民總醫院', admissionDate: '2026-09-28', dischargeDate: '2026-10-02', diagnosis: '示範' });
  assert.equal(snapshot.journey.readiness, 70);
  assert.equal(snapshot.journey.documents[0].entryMethod, 'manual');
  assert.equal(fast(storage).restore().journey.readiness, 70);
});

test('removing a document withdraws readiness and confirmation', async () => {
  const service = fast(memoryStorage());
  await service.analyze(DEMO_STORY);
  await service.uploadDocument('diagnosis_certificate', { sample: true });
  await service.uploadDocument('bank_passbook', { sample: true });
  service.confirm();
  const snapshot = service.removeDocument('bank_passbook');
  assert.equal(snapshot.journey.readiness, 70);
  assert.equal(snapshot.journey.confirmed, false);
});

test('payment change opens a basic journey; car accidents (not a BNP Paribas Cardif life service) and vague input do not', async () => {
  const car = await fast(memoryStorage()).analyze('我今天開車發生擦撞，想知道要準備什麼');
  assert.equal(car.snapshot, null);
  assert.equal(car.understanding.meta.outcome, 'clarification');
  const payment = await fast(memoryStorage()).analyze('我想更改保單的繳費方式');
  assert.equal(payment.snapshot.journey.nextAction.destination.path, '/services/policy-change');
  const kept = await fast(memoryStorage()).analyze('我想更改保單的繳費方式', { openJourney: kind => kind === 'hospital' });
  assert.equal(kept.snapshot, null);
  assert.equal(kept.kind, 'payment_method_change');
  const vague = await fast(memoryStorage()).analyze('你好');
  assert.equal(vague.snapshot, null);
  assert.equal(vague.understanding.meta.outcome, 'clarification');
});

test('a tampered stored session is discarded', () => {
  const storage = memoryStorage();
  storage.setItem('navi.demo.journey', JSON.stringify({ v: 3, journeyId: 'x', story: 'x', understanding: { hacked: true }, documents: [], confirmed: true, handoffRequested: false }));
  assert.equal(fast(storage).restore(), null);
});


test('HTTP demo Golden Path works without secure-context randomUUID', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const realCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) } });
  t.after(() => Object.defineProperty(globalThis, 'crypto', descriptor));
  const storage = memoryStorage();
  const service = fast(storage);
  assert.equal((await service.analyze(DEMO_STORY)).snapshot.journey.readiness, 35);
  assert.equal((await service.uploadDocument('diagnosis_certificate', { sample: true })).journey.readiness, 70);
  assert.equal((await service.uploadDocument('bank_passbook', { sample: true })).journey.readiness, 90);
  const done = service.confirm();
  assert.equal(done.journey.readiness, 100);
  ServiceJourneySchema.parse(done.journey);
  assert.equal(fast(storage).restore().journey.readiness, 100);
});
