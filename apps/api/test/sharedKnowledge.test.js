import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import raw from '../../../data/cardif_seed_data.json' with { type: 'json' };
import { knowledgeEntries, searchKnowledge, getKnowledgeEntry, knowledgeSource, retrieveKnowledgeContext, verifyKnowledgeSource, verifyEvidenceSnippet, verifyNavigationDestination } from '../../../shared/knowledge/index.js';
import { knowledgeEntries as legacyEntries, searchKnowledge as legacySearch } from '../../web/src/domain/knowledge.js';
import { searchPublicKnowledge, retrieveKnowledge } from '../src/services/knowledgeService.js';
import { validateGroundedAnswer } from '../src/services/knowledgeAnswerService.js';
import { findHospitalMention, matchPartnerHospital } from '../../../shared/hospitalization.js';
import { NavigationTargetSchema } from '../../../shared/journey.js';
import { readMessage, NaviMessageSchema, naviMessage } from '../../../shared/embed.js';
import { startHospitalApi } from './hospitalApi.js';
import { InMemoryJourneyRepository } from '../src/repositories/inMemoryJourneyRepository.js';
import { loadKnowledgeDataset, evaluateKnowledge } from '../eval/knowledge/runner.js';

function snapshotLines(entry) {
  const [kind, id] = entry.id.split(/:(.*)/);
  if (kind === 'service') { const s = raw.services.find(s => s.id === id); return [s.name, ...s.channels, ...s.documents, ...s.notes, ...(s.precheck_questions ?? []), s.apply_time, s.effective_time, s.online_available].filter(Boolean); }
  if (kind === 'form') { const f = raw.forms.find(f => f.id === id); return [f.name, f.note].filter(Boolean); }
  if (kind === 'faq') return [raw.faq[Number(id) - 1].a];
  if (kind === 'claim-doc') return Object.values(raw.claim_document_requirements)[Number(id) - 1];
  return [raw.claim_general_rules[Number(id) - 1]];
}

test('all shared sources and evidence derive from the snapshot; legacy IDs and destinations stay compatible', () => {
  assert.deepEqual(knowledgeEntries.map(e => e.id), legacyEntries.map(e => e.id));
  for (const entry of knowledgeEntries) {
    const old = legacyEntries.find(e => e.id === entry.id);
    assert.equal(entry.sourceId, old.id);
    assert.equal(entry.sourceUrl, old.destination.source.url);
    assert.equal(entry.retrievedAt, raw.meta.crawled);
    assert.deepEqual(entry.destination, old.destination);
    assert.deepEqual(entry.details, old.details);
    for (const line of entry.content.split('\n')) assert.ok(snapshotLines(entry).includes(line), `${entry.id}: not a snapshot quote`);
    assert.equal(verifyKnowledgeSource(knowledgeSource(entry)), true);
    NavigationTargetSchema.parse(entry.destination);
  }
  const address = getKnowledgeEntry('service:change_address');
  assert.ok(address.content.includes(raw.services.find(s => s.id === 'change_address').effective_time));
});

test('fake source IDs, dates, content, titles and source/destination substitutions are rejected', () => {
  const entry = getKnowledgeEntry('claim-doc:1'), source = knowledgeSource(entry);
  for (const patch of [{ id: 'fake-source', sourceId: 'fake-source' }, { title: '虛構條款' }, { retrievedAt: '2026-10-13' }, { sourceUrl: 'https://life.cardif.com.tw/zh/invented', url: 'https://life.cardif.com.tw/zh/invented' }, { navigationDestination: getKnowledgeEntry('claim-doc:2').destination }]) assert.equal(verifyKnowledgeSource({ ...source, ...patch }), false);
  assert.equal(knowledgeSource({ ...entry, content: '門診手術保證核付' }), null);
  assert.equal(knowledgeSource({ ...entry, title: '虛構條款' }), null);
  assert.equal(knowledgeSource({ ...entry, sourceId: 'fake-source' }), null);
  assert.equal(verifyKnowledgeSource(null), false);
  assert.equal(getKnowledgeEntry('invented'), null);
});

test('exact snippets and highlights cannot be fabricated or assigned to a different source', () => {
  const query = '線上申請還要寄正本嗎？', result = searchKnowledge(query);
  const lines = result.highlights['service:claim_union_chain'];
  assert.ok(lines.some(line => line.includes('10日內')));
  for (const line of lines) assert.equal(verifyEvidenceSnippet('service:claim_union_chain', line), true);
  assert.equal(verifyEvidenceSnippet('service:change_address', lines[0]), false);
  assert.equal(verifyEvidenceSnippet('service:claim_union_chain', '10日內須寄回正本，否則永遠不能理賠'), false);
  const context = retrieveKnowledgeContext(query);
  validateGroundedAnswer({ answer: context.answer, confidence: .9, supported: true, sourceIds: context.sourceIds }, context);
  for (const bad of ['保證理賠', '請點選 https://evil.example/', `${context.answer}\n不存在的門診條款`]) assert.throws(() => validateGroundedAnswer({ answer: bad, confidence: .9, supported: true, sourceIds: context.sourceIds }, context));
});

test('canonical records are immutable and caller tampering cannot poison subsequent retrieval', () => {
  assert.throws(() => { getKnowledgeEntry('claim-doc:1').destination.path = '/admin'; }, TypeError);
  assert.throws(() => { knowledgeEntries.push({}); }, TypeError);
  const first = searchKnowledge('門診文件'); first.results.length = 0; first.highlights.fake = ['fake'];
  assert.equal(searchKnowledge('門診文件').results[0].id, 'claim-doc:1');
});

test('outpatient and negated hospitalization never select inpatient documents or open a journey', async t => {
  const api = await startHospitalApi(); t.after(() => api.close());
  const queries = ['我只有門診開刀，沒有住院，要怎麼申請理賠？', '我上週門診做了小手術。', '我只有拿診斷書，沒有住院', "I wasn't hospitalized, outpatient treatment only"];
  for (const query of queries) {
    const result = searchKnowledge(query);
    assert.equal(result.status, 'answered'); assert.equal(result.results[0].id, 'claim-doc:1');
    assert.ok([...result.results, ...result.related].every(e => e.id !== 'claim-doc:2'));
    assert.ok(retrieveKnowledgeContext(query).answer.includes('門診收據正本'));
    const intent = await (await api.request('/analyze-intent', { message: query })).json();
    assert.equal(intent.serviceType, 'unknown');
  }
  assert.equal(searchKnowledge('我住院五天，請問應備文件？').results[0].id, 'claim-doc:2');
  assert.equal(searchKnowledge('住院五天，但沒有住院證明，需要哪些文件').results[0].id, 'claim-doc:2');
  assert.ok(searchKnowledge('門診醫起通服務說明').results.some(e => e.id === 'service:claim_hospital_upload'));
});

test('financial decisions and unrelated queries have no sources, excerpts or public legacy fallback', () => {
  for (const query of ['沒有住院，可以申請醫療理賠嗎？', '住院能不能賠', 'which insurance should I buy', '理賠金額是多少', 'outpatient surgery can I claim?']) {
    const r = searchKnowledge(query); assert.equal(r.status, 'out_of_scope'); assert.deepEqual(r.results, []); assert.deepEqual(r.highlights, {}); assert.equal(r.hotline, raw.contacts.hotline); assert.equal(retrieveKnowledgeContext(query), null);
  }
  assert.equal(searchKnowledge('班機延誤要什麼文件').status, 'not_found');
  const legacy = retrieveKnowledge('為什麼需要延誤證明？');
  assert.equal(legacy.found, true); assert.equal(legacy.isMock, true); assert.ok(legacy.sources.every(s => s.type.startsWith('prototype_')));
  assert.equal(searchPublicKnowledge('為什麼需要延誤證明？').results.length, 0);
  for (const query of ['可以給我理賠表單嗎', 'can I download claim form?']) {
    assert.equal(searchKnowledge(query).status, 'answered');
    assert.equal(searchKnowledge(query).results[0].id, 'form:claim_1.1.1');
  }
});

test('all public HTTP queries match shared results and preserve Backend answer contract without AI calls', async t => {
  let calls = 0;
  const provider = { mode: 'live', understandIntent: () => { calls++; throw new Error('Public retrieval must stay local'); }, answerKnowledge: () => { calls++; throw new Error('Public retrieval must stay local'); } };
  const repository = new InMemoryJourneyRepository();
  const api = await startHospitalApi({ provider, repository }); t.after(() => api.close());
  for (const c of (await loadKnowledgeDataset()).filter(c => c.kind === 'query')) {
    const response = await api.request(`/knowledge/search?query=${encodeURIComponent(c.query)}`);
    if (!c.query) { assert.equal(response.status, 400); continue; }
    assert.equal(response.status, 200);
    const actual = await response.json(); assert.deepEqual(actual, searchKnowledge(c.query));
    if (c.status === 'answered') {
      const retrieval = await (await api.request(`/knowledge?query=${encodeURIComponent(c.query)}`)).json();
      assert.equal(retrieval.found, true); assert.equal(retrieval.isMock, false);
      assert.deepEqual(retrieval.results, actual.results);
      for (const source of retrieval.sources) { assert.ok(verifyKnowledgeSource(source)); assert.ok(actual.results.some(r => r.id === source.id)); }
    }
  }
  assert.equal(calls, 0);
  assert.equal(repository.entries.size, 0);
  assert.equal((await api.request('/knowledge/search?query=' + 'a'.repeat(501))).status, 400);
});

test('legacy migration preserves common source identity and evidence while narrowing claim-type matches', () => {
  for (const query of ['改地址', '保單借款', '受益人變更表單在哪下載', '密碼輸錯被鎖住了', '住院要準備什麼文件', '線上申請還要寄正本嗎？']) {
    const frontend = legacySearch(query), backend = searchPublicKnowledge(query);
    assert.equal(frontend.status, backend.status);
    assert.equal(frontend.results[0]?.id, backend.results[0]?.id);
    assert.ok(backend.results.every(r => frontend.results.some(e => e.id === r.id)));
    for (const found of backend.results) {
      const entry = frontend.results.find(r => r.id === found.id);
      assert.deepEqual(found.destination, entry.destination);
      for (const line of frontend.highlights[entry.id]) assert.ok(verifyEvidenceSnippet(found.id, line));
    }
  }
});

test('navigation requires canonical source/path/anchor; exact origins and expected windows remain enforced', () => {
  const valid = getKnowledgeEntry('claim-doc:1').destination;
  for (const patch of [{ path: 'javascript:alert(1)' }, { path: 'data:text/html,evil' }, { path: '//evil.example' }, { path: '/admin' }, { anchor: 'missing' }]) assert.equal(verifyNavigationDestination({ ...valid, ...patch }, 'claim-doc:1'), false);
  assert.equal(verifyNavigationDestination(valid, 'claim-doc:2'), false);
  assert.equal(verifyNavigationDestination(null, 'claim-doc:1'), false);
  const frame = {}, data = naviMessage('navi:navigate', { destination: valid });
  const options = { schema: NaviMessageSchema, allowedOrigins: ['http://127.0.0.1:5173'], expectedSource: frame };
  assert.deepEqual(readMessage({ origin: options.allowedOrigins[0], source: frame, data }, options), data);
  assert.equal(readMessage({ origin: 'https://evil.example', source: frame, data }, options), null);
  assert.equal(readMessage({ origin: options.allowedOrigins[0], source: {}, data }, options), null);
});

test('every shared destination maps to existing mock-site routes and rendered anchors', async () => {
  const root = new URL('../../mock-site/app/', import.meta.url);
  const paths = new Set((await readdir(root, { recursive: true })).filter(f => /(^|\/)page\.tsx$/.test(f)).map(f => '/' + f.split('/').slice(0, -1).filter(s => !/^\(.*\)$/.test(s)).join('/')));
  const forms = await readFile(new URL('(site)/services/forms/page.tsx', root), 'utf8');
  const versions = new Set(JSON.parse(forms.match(/VERSIONED_FORMS = new Set\((\[[^\]]*\])\)/)[1]));
  const claimPrefixes = [...forms.matchAll(/prefix: "([^"]+)"/g)].map(m => m[1]);
  for (const entry of knowledgeEntries) {
    const { path, anchor } = entry.destination; assert.ok(paths.has(path), path);
    const page = await readFile(new URL(`(site)${path}/page.tsx`, root), 'utf8');
    const id = entry.id.split(/:(.*)/)[1];
    if (entry.type === 'service') { const s = raw.services.find(s => s.id === id); assert.ok(page.includes(`getService("${id}")`) || page.includes(`servicesByCategory("${s.category}")`)); }
    else if (entry.type === 'form') { assert.equal(anchor.endsWith('-investment'), versions.has(id)); if (id.startsWith('claim_')) assert.ok(claimPrefixes.some(p => id.startsWith(p))); }
    else assert.ok(page.includes({ faq: 'faqTourId', claim_documents: '`claim-doc-${index + 1}`', claim_rule: '`claim-rule-${index + 1}`' }[entry.type]));
  }
});

test('hospital mention preserves unknown branch text and never relaxes partner matching', () => {
  for (const story of ['我在台中榮總不存在分院住院五天', '我上週在台中榮總不存在分院住院五天']) {
    assert.equal(findHospitalMention(story), '台中榮總不存在分院'); assert.equal(matchPartnerHospital(findHospitalMention(story)), null);
  }
  assert.equal(findHospitalMention('我在榮總住院五天'), '榮總');
  assert.equal(matchPartnerHospital(findHospitalMention('我在榮總住院五天')), null);
  assert.equal(matchPartnerHospital(findHospitalMention('我在台中榮總埔里分院住院五天')), '臺中榮民總醫院埔里分院');
});

test('knowledge evaluation uses authored cases and computes all metrics with zero external attempts', async () => {
  const report = evaluateKnowledge(await loadKnowledgeDataset());
  assert.ok(report.newCases >= 40); assert.equal(report.failed, 0);
  assert.equal(report.metrics.invalidSourceRate.invalid, 0); assert.equal(report.metrics.invalidRouteRate.invalid, 0);
  assert.ok(report.metrics.latencyMs.p95 >= report.metrics.latencyMs.p50);
  assert.equal(report.geminiRequests, 0); assert.equal(report.blockedExternalAttempts, 0);
});
