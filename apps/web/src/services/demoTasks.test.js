import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAdapter } from './adapters.js';
import { mockTasks, splitDemoMessage } from '../mocks/tasks.js';
import { createDemoProvider } from '../../../api/src/ai/demoProvider.js';
import { serializeSession } from './journeyEngine.js';
import { DEMO_STORY } from '../mocks/hospitalClaim.js';

// NAVI-005 / NAVI-010: the public demo handles several requests in one message, offline.
const C1 = '我想改通訊地址，另外還要準備住院理賠，順便找保險金申請書。';

function memoryStorage() {
  const map = new Map();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k), map };
}
const fast = storage => createMockAdapter({ storage, analysisDelayMs: 0, documentDelayMs: 0 });

test('the demo splits a message exactly like the backend demo provider', async () => {
  const backend = createDemoProvider();
  for (const message of [C1, DEMO_STORY, '我想改地址也想改受益人', '我住院了，另外很累', '第一個改地址，第二個改受益人，第三個找申請書，第四個借款，順便問密碼']) {
    const server = await backend.understandTasks(message);
    assert.deepEqual(splitDemoMessage(message), server.tasks.map(task => task.input), message);
  }
});

test('C1: three tasks, each understood by the demo rules, in the server task shape', () => {
  const split = mockTasks(C1);
  assert.deepEqual(split.tasks.map(task => task.input), ['我想改通訊地址', '另外還要準備住院理賠', '順便找保險金申請書。']);
  assert.deepEqual(split.tasks.map(task => task.id), ['task-1', 'task-2', 'task-3']);
  assert.equal(split.tasks[1].data.serviceType, 'hospitalization_claim');
  assert.equal(split.provider, 'demo');
  assert.equal(split.isMock, true);
});

test('several journeys in one tab: switch, the same request goes back to its journey, reload restores them', async () => {
  const storage = memoryStorage();
  const service = fast(storage);
  const hospital = (await service.analyze(DEMO_STORY)).snapshot.journey.id;
  const payment = (await service.analyze('我想更改保單的繳費方式')).snapshot.journey.id;
  assert.notEqual(hospital, payment);
  assert.deepEqual((await service.listJourneys()).map(item => [item.id, item.current]), [[payment, true], [hospital, false]]);

  assert.equal((await service.switchJourney(hospital)).journey.id, hospital);
  assert.equal((await service.uploadDocument('diagnosis_certificate', { sample: true })).journey.readiness, 70);
  const again = await service.analyze(DEMO_STORY);
  assert.equal(again.snapshot.journey.id, hospital, 'no second journey for the same request');
  assert.equal(again.reused, true);
  assert.equal(again.snapshot.journey.readiness, 70, 'its documents are kept');
  assert.equal((await service.listJourneys()).length, 2);

  const reloaded = fast(storage);
  assert.equal(reloaded.restore().journey.id, hospital);
  const listed = await reloaded.listJourneys();
  assert.deepEqual(listed.map(item => [item.id, item.current]), [[hospital, true], [payment, false]]);
  assert.equal(listed[0].readiness, 70);
  assert.equal((await reloaded.switchJourney(payment)).journey.serviceType, 'payment_method_change');

  assert.equal(reloaded.forgetJourney(payment), 1);
  await assert.rejects(reloaded.switchJourney(payment), { code: 'JOURNEY_NOT_FOUND' });
  reloaded.reset();
  assert.equal(fast(storage).restore(), null);
});

test('a journey stored before several were kept is still restored', async () => {
  const storage = memoryStorage();
  const service = fast(storage);
  const { snapshot } = await service.analyze(DEMO_STORY);
  const [session] = JSON.parse(storage.getItem('navi.demo.journey')).sessions;
  storage.setItem('navi.demo.journey', serializeSession((({ v, ...rest }) => rest)(session)));
  const restored = fast(storage);
  assert.equal(restored.restore().journey.id, snapshot.journey.id);
  assert.equal((await restored.listJourneys()).length, 1);
});

test('the requests of one message survive a reload, masked, and anything tampered is dropped', () => {
  const storage = memoryStorage();
  const service = fast(storage);
  const split = mockTasks('我想改通訊地址，電話 0912345678，另外還要準備住院理賠');
  service.saveTasks({ split, tasks: [split.tasks[1]], answered: [split.tasks[0]] });
  assert.ok(![...storage.map.values()].some(value => value.includes('0912345678')));
  const restored = fast(storage).restoreTasks();
  assert.deepEqual(restored.tasks.map(task => task.id), ['task-2']);
  assert.deepEqual(restored.answered.map(task => task.id), ['task-1']);
  assert.match(restored.answered[0].input, /\[已遮蔽電話\]/);

  storage.setItem('navi.demo.journey.tasks', JSON.stringify({ split: { hacked: true }, open: ['task-1'], answered: [] }));
  assert.equal(fast(storage).restoreTasks(), null);
  service.saveTasks(null);
  assert.equal(fast(storage).restoreTasks(), null);
});
