import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDemoProvider } from '../src/ai/demoProvider.js';
import { samplePdf } from './sampleDocuments.js';
import { offlineNetworkStats } from './networkGuard.js';
import { NavigationPlanSchema, JourneyExplanationSchema, HandoffPreviewSchema, HandoffConfirmationSchema } from '../../../shared/competition.js';
import { getKnowledgeEntry, verifyEvidenceSnippet, verifyKnowledgeSource, verifyNavigationDestination } from '../../../shared/knowledge/index.js';
import { buildNavigationPlan, planNavigation, verifyNavigationPlan } from '../../../shared/knowledge/navigationPlan.js';
import { verifiedEvidence, assessSnapshotDate, searchVerifiedKnowledge } from '../../../shared/knowledge/evidence.js';
import { createHandoffConfirmationService, HANDOFF_PREVIEW_TTL_MS } from '../src/services/competitionService.js';

const config = { ...loadConfig({ AI_MODE: 'demo', ALLOW_PAID_AI: 'false' }), rateLimit: 1000 };
const story = '我上週在台中榮總住院五天，要怎麼申請理賠？';
async function server(t, provider = createDemoProvider()) {
  const http = createApp(config, provider).listen(0, '127.0.0.1');
  await new Promise(resolve => http.once('listening', resolve));
  t.after(() => new Promise(resolve => http.close(resolve)));
  const base = `http://127.0.0.1:${http.address().port}/api`;
  return {
    async get(path) { const res = await fetch(base + path); return { status: res.status, data: await res.json() }; },
    async post(path, body = {}) { const res = await fetch(base + path, { method: 'POST', ...(body instanceof FormData ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }); return { status: res.status, data: await res.json() }; },
    async create() { const res = await this.post('/journeys', { message: story }); assert.equal(res.status, 201); return res.data; },
    async upload(id, type) { const form = new FormData(); form.set('file', new Blob([samplePdf(type)], { type: 'application/pdf' }), 'NAVI-synthetic.pdf'); form.set('documentType', type); return this.post(`/journeys/${id}/documents`, form); },
    async remove(id, doc) { return (await fetch(`${base}/journeys/${id}/documents/${doc}`, { method: 'DELETE' })).json(); },
  };
}
const options = { now: new Date('2026-10-21T00:00:00Z') };
test('multi-step navigation preserves source relationships, exact excerpts and canonical destinations', () => {
  for (const id of ['claim-doc:1', 'claim-doc:2', 'service:change_address', 'service:change_beneficiary', 'service:policy_loan', 'faq:7']) {
    const plan = buildNavigationPlan(id, options);
    assert.ok(plan, id); NavigationPlanSchema.parse(plan);
    assert.equal(verifyNavigationPlan(plan, options), true);
    assert.ok(plan.steps.length >= 2, id);
    for (const [index, step] of plan.steps.entries()) {
      assert.equal(step.order, index + 1); assert.equal(verifyKnowledgeSource(step.source), true);
      assert.equal(verifyNavigationDestination(step.destination, step.sourceId), true);
      assert.ok(step.evidence.every(line => verifyEvidenceSnippet(step.sourceId, line)));
      if (step.sourceId !== id) assert.ok(getKnowledgeEntry(id).relatedIds.includes(step.sourceId));
    }
  }
});
test('navigation rejects reordered, skipped, invented or unrelated trusted steps and injected URLs', async t => {
  const plan = buildNavigationPlan('claim-doc:2', options);
  const mutations = [
    p => { p.steps.reverse(); }, p => { p.steps.splice(1, 1); },
    p => { p.steps[0].destination.path = '/admin'; },
    p => { p.steps[0] = buildNavigationPlan('service:policy_loan', options).steps[0]; },
    p => { p.steps[0].evidence = ['住院五天一定核付']; },
    p => { p.steps[0].source.retrievedAt = '2099-01-01'; },
    p => { p.steps[0].destination.source.url = 'javascript:alert(1)'; },
    p => { p.steps[0].destination.url = 'https://evil.example'; },
  ];
  for (const mutate of mutations) { const copy = structuredClone(plan); mutate(copy); assert.equal(verifyNavigationPlan(copy, options), false); }
  const api = await server(t);
  for (const input of [{ query: story, url: 'https://evil.example' }, { sourceId: 'service:change_address', path: '/admin' }, { query: story, sourceId: 'claim-doc:2' }, { sourceId: 'invented' }]) {
    const res = await api.post('/navigation/plans', input);
    if (input.sourceId === 'invented') { assert.equal(res.data.status, 'not_found'); assert.equal(res.data.plan, null); }
    else assert.equal(res.status, 400);
  }
});
test('knowledge evidence distinguishes snapshot validation from live official verification and rejects future/invalid dates', () => {
  const entry = verifiedEvidence('service:change_address', options);
  assert.equal(entry.verificationScope, 'local_snapshot'); assert.equal(entry.liveWebsiteChecked, false);
  assert.equal(entry.snapshot.ageDays, 1);
  assert.equal(verifiedEvidence('made-up-id', options), null);
  assert.equal(verifiedEvidence('service:change_address', { now: new Date('2026-01-01') }), null);
  for (const date of ['2099-01-01', '2026-02-30', 'not-a-date']) assert.equal(assessSnapshotDate(date, options.now).status, 'invalid');
  assert.equal(assessSnapshotDate('2026-01-01', options.now).status, 'review_recommended');
  const search = searchVerifiedKnowledge('理賠聯盟鏈要寄正本嗎', options);
  assert.equal(search.status, 'answered'); assert.ok(search.results.every(r => r.excerpts.every(line => verifyEvidenceSnippet(r.source.id, line))));
});
test('eligibility, unsupported and negated hospitalization queries do not start a journey or invent navigation', async t => {
  const api = await server(t, { mode: 'demo', understandIntent: () => { throw Error('must not call'); } });
  for (const query of ['我住院可以賠多少', '推薦最適合我的保單']) {
    const result = await api.post('/navigation/plans', { query });
    assert.equal(result.data.status, 'out_of_scope'); assert.equal(result.data.plan, null);
    assert.equal((await api.get('/knowledge/evidence?query=' + encodeURIComponent(query))).data.status, 'out_of_scope');
  }
  assert.equal(planNavigation({ query: '火星天氣' }, options).status, 'not_found');
  const outpatient = planNavigation({ query: '我只有門診開刀，沒有住院，要怎麼申請理賠？' }, options);
  assert.equal(outpatient.plan.rootSourceId, 'claim-doc:1');
  assert.ok(outpatient.plan.steps.every(s => s.sourceId !== 'claim-doc:2'));
});
test('explanation follows 35→70→90→100, removal and manual zero-credit without changing workflow', async t => {
  const api = await server(t); let journey = await api.create();
  const check = async expected => {
    const explanation = (await api.get(`/journeys/${journey.id}/explanation`)).data;
    JourneyExplanationSchema.parse(explanation); assert.equal(explanation.readiness, expected);
    assert.equal(explanation.criteria.reduce((sum, item) => sum + item.earned, 0), expected);
    assert.deepEqual(explanation.nextAction, journey.nextAction);
    assert.equal(explanation.currentStage, journey.currentStage);
    assert.ok(explanation.criteria.filter(item => !item.required).every(item => item.weight === 0 && item.earned === 0));
    return explanation;
  };
  await check(35);
  const manual = await api.post(`/journeys/${journey.id}/manual-document-information`, { documentType: 'bank_passbook', fields: { bankName: '合成銀行', accountLast4: '1234' } });
  journey = manual.data.journey;
  assert.equal((await check(35)).criteria.find(r => r.id === 'bank_passbook').reasonCode, 'MANUAL_UNVERIFIED');
  const first = await api.upload(journey.id, 'diagnosis_certificate'); journey = first.data.journey; await check(70);
  journey = (await api.upload(journey.id, 'bank_passbook')).data.journey; await check(90);
  journey = (await api.post(`/journeys/${journey.id}/review`, { confirmed: true })).data; await check(100);
  journey = await api.remove(journey.id, first.data.document.id); await check(55);
  assert.equal(journey.confirmed, false);
});
test('explanation exposes contradictions and failed validation without leaking extracted fields', async t => {
  const demo = createDemoProvider();
  const api = await server(t, { ...demo, analyzeDocument: async (...args) => { const doc = await demo.analyzeDocument(...args); doc.fields.hospitalName = '合成不一致醫院'; return doc; } });
  const journey = await api.create(); await api.upload(journey.id, 'diagnosis_certificate');
  const { data } = await api.get(`/journeys/${journey.id}/explanation`);
  assert.equal(data.currentStage, 'HUMAN_REVIEW'); assert.equal(data.readiness, 35);
  assert.equal(data.nextAction.type, 'CONTACT_SPECIALIST'); assert.ok(data.consistencyIssues.length);
  assert.equal(data.criteria.find(r => r.id === 'diagnosis_certificate').reasonCode, 'DOCUMENT_NEEDS_REVIEW');
  assert.ok(!JSON.stringify(data).includes('合成不一致醫院'));
});
test('handoff requires a separate explicit consent, exports only redacted preview and sends nothing', async t => {
  const api = await server(t); const journey = await api.create();
  await api.upload(journey.id, 'diagnosis_certificate'); await api.upload(journey.id, 'bank_passbook');
  const before = (await api.get(`/journeys/${journey.id}`)).data;
  const preview = await api.post(`/journeys/${journey.id}/handoff/preview`);
  assert.equal(preview.status, 201); HandoffPreviewSchema.parse(preview.data);
  const text = JSON.stringify(preview.data);
  for (const secret of ['NAVI SYNTHETIC PATIENT', '1234', 'accountLast4', 'patientName', 'NAVI-synthetic.pdf', '2026-10-01', '台中榮總']) assert.ok(!text.includes(secret), secret);
  for (const body of [{ previewId: preview.data.previewId, confirmed: false }, { previewId: preview.data.previewId }, { previewId: preview.data.previewId, confirmed: true, summary: { issue: 'injected' } }]) assert.equal((await api.post(`/journeys/${journey.id}/handoff/confirm`, body)).status, 400);
  const confirmed = await api.post(`/journeys/${journey.id}/handoff/confirm`, { previewId: preview.data.previewId, confirmed: true });
  assert.equal(confirmed.status, 200); HandoffConfirmationSchema.parse(confirmed.data);
  assert.equal(confirmed.data.delivery, 'not_sent'); assert.deepEqual(confirmed.data.summary, preview.data.summary);
  assert.deepEqual((await api.get(`/journeys/${journey.id}`)).data, before);
  assert.equal((await api.post(`/journeys/${journey.id}/handoff/confirm`, { previewId: preview.data.previewId, confirmed: true })).status, 409);
});
test('handoff rejects stale, cross-journey, replaced and expired previews; cache stays bounded', async t => {
  const api = await server(t); const journey = await api.create(); const other = await api.create();
  const preview = (await api.post(`/journeys/${journey.id}/handoff/preview`)).data;
  const body = { previewId: preview.previewId, confirmed: true };
  assert.equal((await api.post(`/journeys/${other.id}/handoff/confirm`, body)).status, 409);
  await api.upload(journey.id, 'diagnosis_certificate');
  assert.equal((await api.post(`/journeys/${journey.id}/handoff/confirm`, body)).data.error.code, 'HANDOFF_PREVIEW_STALE');
  let now = Date.now();
  const memory = new Map([[journey.id, journey], [other.id, other]]);
  const service = createHandoffConfirmationService({ getJourney: id => memory.get(id), now: () => now, maxEntries: 1 });
  const first = service.preview(journey.id); const replacement = service.preview(journey.id);
  assert.throws(() => service.confirm(journey.id, { previewId: first.previewId, confirmed: true }), { code: 'HANDOFF_PREVIEW_INVALID' });
  assert.throws(() => service.preview(other.id), { code: 'HANDOFF_CAPACITY_REACHED' });
  now += HANDOFF_PREVIEW_TTL_MS;
  assert.throws(() => service.confirm(journey.id, { previewId: replacement.previewId, confirmed: true }), { code: 'HANDOFF_PREVIEW_INVALID' });
  assert.ok(service.preview(other.id));
});
test('old endpoints and navigation messages stay intact; new routes remain offline', async t => {
  const api = await server(t); const journey = await api.create();
  assert.equal((await api.get(`/journeys/${journey.id}/handoff-summary`)).status, 200);
  assert.equal((await api.get('/knowledge/search?query=' + encodeURIComponent('我搬家了'))).data.status, 'answered');
  assert.equal((await api.get('/journeys/00000000-0000-4000-8000-000000000000/explanation')).status, 404);
  assert.deepEqual(offlineNetworkStats(), { blockedExternalAttempts: 0, externalRequests: 0 });
});

test('unsupported journey explanations remain zero and empty without inventing requirements', async t => {
  const api = await server(t);
  const journey = (await api.post('/journeys', { message: '我要更改地址' })).data;
  const result = JourneyExplanationSchema.parse((await api.get(`/journeys/${journey.id}/explanation`)).data);
  assert.equal(result.supported, false); assert.equal(result.readiness, 0); assert.deepEqual(result.criteria, []);
});
test('handoff confirmation service itself rejects absent or false consent', async t => {
  const api = await server(t); const journey = await api.create();
  const service = createHandoffConfirmationService({ getJourney: () => journey });
  const preview = service.preview(journey.id);
  assert.throws(() => service.confirm(journey.id, { previewId: preview.previewId, confirmed: false }), { code: 'INVALID_INPUT' });
  assert.equal(service.confirm(journey.id, { previewId: preview.previewId, confirmed: true }).delivery, 'not_sent');
});
test('evidence metrics use measured percentiles and runner only names local commands', async () => {
  const { latencySummary, parseReport, evidenceJobs } = await import('../../../scripts/evidence-pack.js');
  assert.deepEqual(latencySummary([9, 1, 4, 2, 3]), { samples: 5, p50: 3, p95: 9 });
  assert.throws(() => latencySummary([])); assert.throws(() => latencySummary([NaN]));
  assert.deepEqual(parseReport('npm banner\n{\n"passed": 2\n}'), { passed: 2 });
  assert.throws(() => parseReport('no report'));
  assert.ok(evidenceJobs.every(([, args]) => !args.some(arg => /live|install|deploy/.test(arg))));
  assert.ok(evidenceJobs.some(([id]) => id === 'build'));
});
