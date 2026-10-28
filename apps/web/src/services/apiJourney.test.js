import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiJourneyService, understandingOfTask } from './apiJourney.js';
import { understandIntent } from './intelligence.js';
import { DEMO_STORY } from '../mocks/hospitalClaim.js';
// Formal mode talks to the real backend; run it in-process with the scripted demo provider (no AI calls).
import { createApp } from '../../../api/src/app.js';
import { loadConfig } from '../../../api/src/config/env.js';
import { createDemoProvider } from '../../../api/src/ai/demoProvider.js';

const config = { ...loadConfig({ AI_MODE: 'demo' }), rateLimit: 1000 };

async function backend(t) {
  const http = createApp(config, createDemoProvider()).listen(0, '127.0.0.1');
  await new Promise(resolve => http.once('listening', resolve));
  t.after(() => new Promise(resolve => http.close(resolve)));
  return `http://127.0.0.1:${http.address().port}`;
}
function memoryStorage() {
  const map = new Map();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
}
const client = (baseUrl, storage = memoryStorage()) => createApiJourneyService({
  baseUrl, storage, understand: (message, { signal } = {}) => understandIntent(message, { signal, baseUrl }),
});

test('formal mode renders the server-owned 住院 journey: 35 → 70 → 90 → 100, and removal withdraws', async t => {
  const service = client(await backend(t));
  const { snapshot } = await service.analyze(DEMO_STORY);
  assert.equal(snapshot.context.kind, 'hospital');
  assert.equal(snapshot.journey.readiness, 35);
  assert.equal(snapshot.journey.currentStage, 'EVIDENCE_COLLECTION');
  assert.equal(snapshot.journey.claimContext.hospital.matchedName, '臺中榮民總醫院');
  assert.equal(snapshot.journey.nextAction.target, 'diagnosis_certificate');

  const certificate = await service.uploadDocument('diagnosis_certificate', { sample: true });
  assert.equal(certificate.journey.readiness, 70);
  const document = certificate.journey.documents[0];
  assert.equal(document.isMock, true, 'demo provider fixtures are labelled as mock');
  assert.equal(document.fields.diagnosis, null, 'clinical details are not extracted');

  assert.equal((await service.uploadDocument('bank_passbook', { sample: true })).journey.currentStage, 'READY_FOR_REVIEW');
  const done = await service.confirm();
  assert.equal(done.journey.readiness, 100);
  assert.equal(done.journey.currentStage, 'READY_TO_PROCEED');
  assert.equal(done.journey.nextAction.target, 'hospital_upload');

  const removed = await service.removeDocument('bank_passbook');
  assert.equal(removed.journey.readiness, 70);
  assert.equal(removed.journey.confirmed, false);
});

test('a reload reads the journey back from the server; an expired journey is cleared', async t => {
  const storage = memoryStorage();
  const baseUrl = await backend(t);
  const first = client(baseUrl, storage);
  const { snapshot } = await first.analyze(DEMO_STORY);
  await first.uploadDocument('diagnosis_certificate', { sample: true });

  const reloaded = client(baseUrl, storage);
  assert.equal(reloaded.restore(), null, 'nothing is rendered from the browser copy');
  const resumed = await reloaded.resume();
  assert.equal(resumed.journey.id, snapshot.journey.id);
  assert.equal(resumed.journey.readiness, 70);

  // A restarted server (new in-memory repository) no longer has the journey.
  const restarted = client(await backend(t), storage);
  restarted.restore();
  await assert.rejects(restarted.resume(), { code: 'JOURNEY_NOT_FOUND', message: '這份服務旅程已失效或不存在，請重新開始。' });
  assert.equal(storage.getItem('navi.journey'), null);
});

test('the browser keeps only the journey id; the description is masked and never stored', async t => {
  const storage = memoryStorage();
  const baseUrl = await backend(t);
  const service = client(baseUrl, storage);
  const story = '我上週在台中榮總住院五天，我的電話 0912-345-678，身分證 A123456789，要怎麼申請理賠？';
  const { snapshot } = await service.analyze(story);
  await service.uploadDocument('diagnosis_certificate', { sample: true });

  const stored = storage.getItem('navi.journey');
  assert.deepEqual(Object.keys(JSON.parse(stored)).sort(), ['current', 'journeys', 'v']);
  assert.deepEqual(Object.keys(JSON.parse(stored).journeys[0]).sort(), ['handoffRequested', 'journeyId', 'source']);
  for (const secret of ['0912', 'A123456789', '台中榮總', 'NAVI SYNTHETIC PATIENT']) assert.ok(!stored.includes(secret), secret);
  assert.doesNotMatch(snapshot.context.story, /0912|A123456789/);
  assert.match(snapshot.context.story, /台中榮總住院五天/);
  // After a reload only the server's neutral note is available.
  const reloaded = client(baseUrl, storage);
  reloaded.restore();
  assert.doesNotMatch((await reloaded.resume()).context.story, /台中榮總|0912/);

  // A stored copy from the previous format (which held the raw description) is discarded.
  const legacy = memoryStorage();
  legacy.setItem('navi.journey', JSON.stringify({ v: 1, story, journey: snapshot.journey, source: 'demo_fallback', handoffRequested: false }));
  assert.equal(client('http://unused', legacy).restore(), null);
  assert.equal(legacy.getItem('navi.journey'), null);
});

test('several journeys: each is listed and read back from the server, switching never mixes their state', async t => {
  const storage = memoryStorage();
  const baseUrl = await backend(t);
  const service = client(baseUrl, storage);
  const first = (await service.analyze(DEMO_STORY)).snapshot.journey;
  await service.uploadDocument('diagnosis_certificate', { sample: true });
  const second = (await service.analyze('我上個月在臺大醫院住院三天，想申請住院理賠')).snapshot.journey;
  assert.notEqual(first.id, second.id);

  const listed = await service.listJourneys();
  assert.deepEqual(listed.map(item => [item.id, item.current, item.readiness]), [[second.id, true, 35], [first.id, false, 70]]);
  assert.equal(listed[1].title, '住院醫療理賠');

  const back = await service.switchJourney(first.id);
  assert.equal(back.journey.id, first.id);
  assert.equal(back.journey.readiness, 70, 'state comes from the server, not from a local copy');
  assert.equal((await service.uploadDocument('bank_passbook', { sample: true })).journey.readiness, 90);
  assert.equal((await service.switchJourney(second.id)).journey.readiness, 35, 'the other journey is untouched');

  // After a reload the browser still knows both ids and shows the one in use.
  const reloaded = client(baseUrl, storage);
  reloaded.restore();
  assert.equal((await reloaded.resume()).journey.id, second.id);
  assert.equal((await reloaded.listJourneys()).length, 2);
});

test('one expired journey leaves the list; the others stay', async t => {
  const storage = memoryStorage();
  const service = client(await backend(t), storage);
  const first = (await service.analyze(DEMO_STORY)).snapshot.journey;
  await service.analyze('我上個月在臺大醫院住院三天，想申請住院理賠');
  // The server restarted (in-memory journeys are gone): every id is unknown there now.
  const restarted = client(await backend(t), storage);
  restarted.restore();
  await assert.rejects(restarted.switchJourney(first.id), { code: 'JOURNEY_NOT_FOUND' });
  assert.equal(JSON.parse(storage.getItem('navi.journey')).journeys.length, 1, 'only the expired journey was dropped');
  assert.deepEqual(await restarted.listJourneys(), []);
  assert.equal(storage.getItem('navi.journey'), null);
});

test('the user removes one journey from this browser; the others stay and the shown one closes', async t => {
  const storage = memoryStorage();
  const service = client(await backend(t), storage);
  const first = (await service.analyze(DEMO_STORY)).snapshot.journey;
  const second = (await service.analyze('我上個月在臺大醫院住院三天，想申請住院理賠')).snapshot.journey;
  assert.equal(service.forgetJourney(first.id), 1, 'a journey not shown is forgotten');
  assert.deepEqual((await service.listJourneys()).map(item => item.id), [second.id]);
  assert.equal(service.forgetJourney(second.id), 0, 'the shown journey is forgotten too');
  assert.equal(storage.getItem('navi.journey'), null);
  assert.deepEqual(await service.listJourneys(), []);
});

test('the page learns what answers on the server: a demo server is never presented as AI', async t => {
  const service = client(await backend(t));
  assert.equal(service.aiMode, null, 'unknown until the server answers');
  let changes = 0;
  const stop = service.subscribeAiMode(() => { changes += 1; });
  assert.equal(await service.checkAiMode(), 'demo');
  assert.equal(service.aiMode, 'demo');
  assert.equal(changes, 1);
  await service.analyze(DEMO_STORY);
  assert.equal(changes, 1, 'the same mode is not announced again');
  stop();
});

test('the earlier single-journey format is kept as a one-item list', () => {
  const storage = memoryStorage();
  const journeyId = '00000000-0000-4000-8000-000000000001';
  storage.setItem('navi.journey', JSON.stringify({ v: 2, journeyId, source: 'gemini', handoffRequested: false }));
  const service = client('http://unused', storage);
  service.restore();
  assert.equal(service.hasStoredJourney(), true);
});

test('only 住院醫療理賠 opens a server journey; outpatient-only and other services stay on the landing page', async t => {
  const service = client(await backend(t));
  for (const story of ['我只有門診開刀，沒有住院，要怎麼申請理賠？', '我想更改保單的繳費方式', '你好']) {
    const result = await service.analyze(story);
    assert.equal(result.snapshot, null, story);
  }
  assert.equal(service.restore(), null);
});

test('a 住院 information question (knowledge_query) never creates a journey', async t => {
  const baseUrl = await backend(t);
  const question = { success: true, data: { intent: 'knowledge_query', serviceType: 'hospitalization_claim', confidence: 0.9, summary: '詢問住院理賠文件', extractedData: { origin: null, destination: null, delayMinutes: null, incidentDate: null } }, meta: { source: 'gemini', confidenceThreshold: 0.65, outcome: 'preview' } };
  const service = createApiJourneyService({ baseUrl, storage: memoryStorage(), understand: async () => question });
  const result = await service.analyze('住院要準備什麼文件');
  assert.equal(result.snapshot, null);
  assert.equal(result.kind, 'hospital');
});

test('server errors reach the user as written', async t => {
  const service = client(await backend(t));
  await service.analyze(DEMO_STORY);
  await assert.rejects(service.submitManual('bank_passbook', { bankName: null, accountLast4: null }), error => error.code === 'INVALID_INPUT' && error.status === 400);
});

test('formal mode is real use: a demo server never "recognises" the user\'s own file', async t => {
  let posted = 0;
  const baseUrl = await backend(t);
  const service = createApiJourneyService({
    baseUrl, storage: memoryStorage(),
    understand: (message, { signal } = {}) => understandIntent(message, { signal, baseUrl }),
    fetchImpl: (url, init) => { if (init?.method === 'POST' && String(url).endsWith('/documents')) posted += 1; return fetch(url, init); },
  });
  assert.equal(service.capabilities.samples, 'ai', 'the formal sample is sent to the server, never filled in locally');
  await service.analyze(DEMO_STORY);
  const photo = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9])], 'photo.jpg', { type: 'image/jpeg' });
  await assert.rejects(service.uploadDocument('diagnosis_certificate', { file: photo }), error => error.code === 'DOCUMENT_RECOGNITION_UNAVAILABLE' && /尚未啟用文件辨識/.test(error.message));
  assert.equal(posted, 0, 'the file is not sent to a demo server');
});

test('fixture fields returned for the user\'s own file are withdrawn when the mode header is missing', async t => {
  const baseUrl = await backend(t);
  const dropHeader = async (url, init) => {
    const response = await fetch(url, init);
    const headers = new Headers(response.headers);
    headers.delete('X-NAVI-AI-Mode');
    return new Response(await response.arrayBuffer(), { status: response.status, headers });
  };
  const service = createApiJourneyService({
    baseUrl, storage: memoryStorage(), fetchImpl: dropHeader,
    understand: (message, { signal } = {}) => understandIntent(message, { signal, baseUrl }),
  });
  await service.analyze(DEMO_STORY);
  const pdf = new File(['%PDF-1.4\nmy own scan\n%%EOF'], 'scan.pdf', { type: 'application/pdf' });
  await assert.rejects(service.uploadDocument('diagnosis_certificate', { file: pdf }), { code: 'DOCUMENT_RECOGNITION_UNAVAILABLE' });
  const explanation = await service.explain();
  assert.equal(explanation.criteria.find(c => c.id === 'diagnosis_certificate').reasonCode, 'DOCUMENT_MISSING', 'the sample fields are not kept');
});

test('formal-mode manual information is stored as 待確認: no readiness, no document, no review; a verified upload replaces it', async t => {
  const service = client(await backend(t));
  assert.deepEqual(service.capabilities, { manualEntry: false, manualInformation: true, samples: 'ai', tasks: true, correction: true, journeys: true, uploadProgress: true });
  await service.analyze(DEMO_STORY);
  const typed = await service.submitManual('diagnosis_certificate', { hospitalName: '臺中榮民總醫院', admissionDate: '2026-10-01', dischargeDate: '2026-10-05', reportedInpatientDays: 5 });
  assert.equal(typed.journey.readiness, 35, 'manual information adds no readiness');
  assert.equal(typed.journey.documents.length, 0, 'it is not a document');
  assert.deepEqual(typed.journey.manualDocumentInformation.map(m => [m.documentType, m.source, m.status]), [['diagnosis_certificate', 'manual', 'needs_review']]);
  await service.submitManual('bank_passbook', { bankName: '示範銀行', accountLast4: '1234' });
  await assert.rejects(service.confirm(), { status: 409 }, 'manual information cannot unlock review');

  const removed = await service.removeManual('bank_passbook');
  assert.deepEqual(removed.journey.manualDocumentInformation.map(m => m.documentType), ['diagnosis_certificate']);
  const uploaded = await service.uploadDocument('diagnosis_certificate', { sample: true });
  assert.equal(uploaded.journey.readiness, 70);
  assert.ok(!(uploaded.journey.manualDocumentInformation ?? []).some(m => m.documentType === 'diagnosis_certificate'), 'the verified upload clears the typed information');
});

test('formal mode: explanation reason codes and the consent-based handoff (preview → confirm, nothing sent)', async t => {
  const service = client(await backend(t));
  await service.analyze(DEMO_STORY);
  const { journey } = await service.uploadDocument('diagnosis_certificate', { sample: true });
  const explanation = await service.explain();
  assert.equal(explanation.journeyUpdatedAt, journey.updatedAt);
  assert.equal(explanation.criteria.find(c => c.id === 'diagnosis_certificate').reasonCode, 'VERIFIED');
  assert.equal(explanation.criteria.find(c => c.id === 'bank_passbook').reasonCode, 'DOCUMENT_MISSING');

  const preview = await service.handoffPreview();
  assert.equal(preview.status, 'awaiting_confirmation');
  assert.equal(preview.summary.redacted, true);
  assert.ok(!JSON.stringify(preview.summary).includes('臺中榮民總醫院'), 'no hospital value in the summary');
  const confirmed = await service.confirmHandoff(preview.previewId);
  assert.equal(confirmed.delivery, 'not_sent');

  // A preview of an older journey version cannot be confirmed.
  const old = await service.handoffPreview();
  await service.uploadDocument('bank_passbook', { sample: true });
  await assert.rejects(service.confirmHandoff(old.previewId), { code: 'HANDOFF_PREVIEW_STALE' });
});

test('formal mode: step-by-step guide plans come from the server and match the shared plan', async t => {
  const service = client(await backend(t));
  const result = await service.navigationPlan('service:change_address');
  assert.equal(result.status, 'answered');
  assert.deepEqual(result.plan.steps.map(s => s.action), ['VIEW_INFORMATION', 'VIEW_FORM']);
  assert.equal(result.plan.steps[0].destination.anchor, 'service-change-address');
  // Unreachable API: the same plan is built locally from the shared snapshot.
  const offline = client('http://127.0.0.1:9');
  assert.deepEqual((await offline.navigationPlan('service:change_address')).plan, result.plan);
});

test('several requests in one message are listed as tasks; a chosen task opens its journey without a second AI call', async t => {
  const baseUrl = await backend(t);
  let understands = 0;
  const service = createApiJourneyService({
    baseUrl, storage: memoryStorage(),
    understand: (message, { signal } = {}) => { understands += 1; return understandIntent(message, { signal, baseUrl }); },
  });
  const split = await service.understandTasks('我想改地址，也想知道要怎麼申請住院理賠。');
  assert.equal(split.nextStep, 'confirm_one_task');
  assert.deepEqual(split.tasks.map(task => task.data.serviceType), ['policy_change', 'hospitalization_claim']);
  assert.deepEqual(split.tasks.map(task => task.input), ['我想改地址', '我也想知道要怎麼申請住院理賠']);
  const hospital = split.tasks[1];
  const understanding = understandingOfTask(split, hospital);
  assert.ok(understanding, 'a task becomes a valid single understanding');
  const { snapshot } = await service.analyze(hospital.input, { understanding });
  assert.equal(snapshot.journey.serviceType, 'hospitalization_claim');
  assert.equal(understands, 0, 'the chosen task is not analysed again');
});

test('an older server without /intelligence/tasks falls back to a single understanding', async () => {
  const service = createApiJourneyService({
    baseUrl: 'http://unused', storage: memoryStorage(), understand: async () => null,
    fetchImpl: async () => new Response(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'not found' } }), { status: 404, headers: { 'Content-Type': 'application/json' } }),
  });
  assert.equal(await service.understandTasks('我想改地址，也想申請住院理賠'), null);
});

test('correcting the need re-reads it on the server: kept documents earn nothing until confirmed again', async t => {
  const service = client(await backend(t));
  await service.analyze(DEMO_STORY);
  assert.equal((await service.uploadDocument('diagnosis_certificate', { sample: true })).journey.readiness, 70);
  const { snapshot, previousServiceType } = await service.correctIntent('我其實沒有住院，只是門診。');
  assert.equal(previousServiceType, 'hospitalization_claim');
  assert.notEqual(snapshot.journey.serviceType, 'hospitalization_claim');
  assert.equal(snapshot.journey.readiness, 0, 'no score carried over');
  assert.ok(snapshot.journey.documents.every(d => d.status === 'needs_review'), 'kept documents need confirming');
  assert.equal(snapshot.context.kind, snapshot.journey.serviceType, 'the client follows the corrected service');
  assert.equal((await service.refresh()).journey.id, snapshot.journey.id);
});


test('a delayed journey selection cannot overwrite the latest selected journey', async t => {
 const baseUrl=await backend(t),storage=memoryStorage();let delayedId,arrived,release;const waiting=new Promise(r=>arrived=r),hold=new Promise(r=>release=r);
 const service=createApiJourneyService({baseUrl,storage,understand:(message,options)=>understandIntent(message,{...options,baseUrl}),fetchImpl:async(url,init)=>{const response=await fetch(url,init);if(new URL(url).pathname==='/api/journeys/'+delayedId&&(!init.method||init.method==='GET')){arrived();await hold;}return response;}});
 const first=(await service.analyze(DEMO_STORY)).snapshot.journey,second=(await service.analyze('我在臺大醫院住院三天')).snapshot.journey;delayedId=first.id;
 const older=service.switchJourney(first.id);await waiting;await service.switchJourney(second.id);const rejected=assert.rejects(older,{name:'AbortError'});release();await rejected;
 assert.equal(JSON.parse(storage.getItem('navi.journey')).current,second.id);assert.equal((await service.listJourneys()).find(j=>j.current).id,second.id);
});

test('a late upload response stays with its original journey after a selection changes', async t => {
 const baseUrl=await backend(t),storage=memoryStorage();let arrived,release;const waiting=new Promise(r=>arrived=r),hold=new Promise(r=>release=r);
 const service=createApiJourneyService({baseUrl,storage,understand:(message,options)=>understandIntent(message,{...options,baseUrl}),fetchImpl:async(url,init)=>{const response=await fetch(url,init);if(String(url).endsWith('/documents')&&init.method==='POST'){arrived();await hold;}return response;}});
 const first=(await service.analyze(DEMO_STORY)).snapshot.journey,second=(await service.analyze('我在臺大醫院住院三天')).snapshot.journey;await service.switchJourney(first.id);
 const uploading=service.uploadDocument('diagnosis_certificate',{sample:true});await waiting;await service.switchJourney(second.id);const rejected=assert.rejects(uploading,{code:'JOURNEY_STALE'});release();await rejected;
 const list=await service.listJourneys();assert.equal(list.find(j=>j.current).id,second.id);assert.equal(list.find(j=>j.id===second.id).readiness,35);assert.equal(list.find(j=>j.id===first.id).readiness,70);
});


test('late handoff confirmation cannot mark a different selected journey as confirmed', async t => {
 const baseUrl=await backend(t),storage=memoryStorage();let arrived,release;const waiting=new Promise(r=>arrived=r),hold=new Promise(r=>release=r);
 const service=createApiJourneyService({baseUrl,storage,understand:(message,options)=>understandIntent(message,{...options,baseUrl}),fetchImpl:async(url,init)=>{const response=await fetch(url,init);if(String(url).endsWith('/handoff/confirm')){arrived();await hold;}return response;}});
 const first=(await service.analyze(DEMO_STORY)).snapshot.journey,second=(await service.analyze('我在臺大醫院住院三天')).snapshot.journey;await service.switchJourney(first.id);const p=await service.handoffPreview(),confirming=service.confirmHandoff(p.previewId);await waiting;await service.switchJourney(second.id);const rejected=assert.rejects(confirming,{code:'JOURNEY_STALE'});release();await rejected;const stored=JSON.parse(storage.getItem('navi.journey'));assert.equal(stored.current,second.id);assert.equal(stored.journeys.find(j=>j.journeyId===second.id).handoffRequested,false);
});
