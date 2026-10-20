import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cardif } from '../../../shared/cardif.js';
import raw from '../../../data/cardif_seed_data.json' with { type: 'json' };
import { knowledgeEntries, searchKnowledge, verifyEvidenceSnippet, verifyNavigationDestination, retrieveKnowledgeContext } from '../../../shared/knowledge/index.js';
import { searchPublicKnowledge } from '../src/services/knowledgeService.js';

const pages = (await readFile(new URL('../../../data/crawl/review-2026-10-20/pages.jsonl', import.meta.url), 'utf8')).trim().split('\n').map(JSON.parse);
test('all four address queries keep the same verified source and canonical navigation', () => {
  for (const query of ['我要變更地址', '我搬家了', '如何修改通訊地址', '保單的地址要去哪裡修改']) {
    const shared = searchKnowledge(query), backend = searchPublicKnowledge(query);
    assert.equal(shared.status, 'answered'); assert.equal(shared.results[0].id, 'service:change_address');
    assert.deepEqual(shared, backend);
    const entry = shared.results[0], source = pages.find(p => p.url === entry.sourceUrl);
    assert.equal(entry.retrievedAt, source.retrievedAt); assert.equal(entry.destination.path, '/services/policy-change');
    assert.equal(entry.destination.anchor, 'service-change-address'); assert.equal(verifyNavigationDestination(entry.destination, entry.id), true);
    for (const line of entry.content.split('\n')) assert.ok(source.content_text.includes(line), line);
    assert.doesNotMatch(JSON.stringify(shared), /internal_notes|頁面寫紙本|部分：|待確認|內部筆記|還沒修/);
  }
});
test('internal address notes remain private and are absent from validated public seed', () => {
  const privateNote = raw.services.find(s => s.id === 'change_address').internal_notes;
  assert.ok(privateNote.previous_online_note);
  assert.equal(cardif.services.find(s => s.id === 'change_address').internal_notes, undefined);
  for (const query of ['我要變更地址', '通訊地址線上改']) assert.ok(!retrieveKnowledgeContext(query).answer.includes(privateNote.previous_online_note));
});
test('published glossary definitions are literal official snapshot text with valid sources and real anchors', () => {
  assert.equal(cardif.glossary.length, 7);
  for (const term of cardif.glossary) {
    const source = pages.find(p => p.url === term.sourceUrl);
    assert.ok(source.content_text.includes(term.definition)); assert.equal(term.retrievedAt, source.retrievedAt);
    assert.ok(term.category && term.keywords.length); assert.equal(term.sourceType, 'public_site_snapshot');
    const entry = knowledgeEntries.find(e => e.id === `glossary:${term.id}`);
    assert.equal(entry.content, term.definition); assert.equal(verifyEvidenceSnippet(entry.id, term.definition), true);
    assert.equal(verifyEvidenceSnippet(entry.id, term.definition + '保證理賠'), false);
    assert.equal(verifyNavigationDestination(entry.destination, entry.id), true);
    assert.equal(entry.destination.anchor, `glossary-term-${term.id}`);
    assert.equal(searchKnowledge(term.term + '是什麼').results[0].id, entry.id);
  }
  assert.equal(searchKnowledge('我適合買哪個保單').status, 'out_of_scope');
});
