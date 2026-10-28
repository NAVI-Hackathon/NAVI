import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeStore, importCandidates, approveFaqAppend, listReviews, sha256 } from '../../../scripts/knowledge/lifecycle.js';
import { verifyFaqRelease } from '../../../scripts/knowledge/verify-release.js';
import current from '../../../knowledge/releases/kb-1404d058190e380c66eedee1.json' with { type: 'json' };
import previous from '../../../knowledge/releases/kb-ba0d6f040c788ecc9b406687.json' with { type: 'json' };

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'navi-release-audit-')); t.after(() => rmSync(root, { recursive: true }));
  mkdirSync(join(root, 'data')); writeFileSync(join(root, 'data/cardif_public_data.json'), JSON.stringify(previous.snapshot));
  const store = join(root, 'private'), { tokenFile } = initializeStore(store);
  const json = file => JSON.parse(readFileSync(new URL('../../../' + file, import.meta.url), 'utf8'));
  const report = json('docs/knowledge-crawl-diff-2026-10-21.json');
  const pages = readFileSync(new URL('../../../data/crawl/candidate-2026-10-21/pages.jsonl', import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
  await importCandidates({ store, tokenFile, report, pages });
  const added = current.snapshot.faq.slice(previous.snapshot.faq.length);
  await approveFaqAppend({ root, store, tokenFile, reviewer: 'SYNTHETIC TEST ACTOR', reason: 'isolated offline verification fixture', wholePageConfirmed: true,
    plan: { operation: 'append_faq', changeIds: current.approvedChangeIds, entries: added.map(({ q, a }) => ({ q, a })), anchorsConfirmed: added.map((_, i) => `faq-${previous.snapshot.faq.length + i + 1}`), workflowCompatibility: 'reviewed_no_rule_change' } });
  return { store, reviews: listReviews(store) };
}
test('Audit proves 23 signed decisions map to 10 literal FAQs; headings and cross-boundary spans are explicit', async t => {
  const { reviews } = await fixture(t); const report = verifyFaqRelease(current, previous, reviews);
  assert.equal(report.approvedItems, 23); assert.equal(report.addedParagraphs, 22); assert.equal(report.wholePageReviews, 1); assert.equal(report.addedFaqs, 10);
  assert.equal(report.candidates[0].mappingScope, 'page_heading_context_only');
  assert.ok(report.candidates.some(c => c.mappingScope === 'literal_span_overlap' && c.sourceIds.length > 1));
  assert.deepEqual(report.faq.map(f => f.sourceId), Array.from({ length: 10 }, (_, i) => `faq:${13 + i}`));
  assert.ok(report.faq.every(f => f.retrievedAt === '2026-10-21' && f.publishedAt === null));
});
test('Unapproved or synthetic decisions and incomplete whole-page authorization cannot pass', async t => {
  const { reviews } = await fixture(t);
  for (const mutate of [r => { r[0].status = 'PENDING'; }, r => { r[0].decision.synthetic = true; }, r => { r.at(-1).decision.wholePageConfirmed = false; }, r => { r[0].decision.reviewer = ''; }]) {
    const rows = structuredClone(reviews); mutate(rows); assert.throws(() => verifyFaqRelease(current, previous, rows));
  }
});
test('Candidate text and signed mapping hashes cannot be substituted', async t => {
  const { reviews } = await fixture(t);
  for (const mutate of [r => { r[1].new.text += 'invented'; }, r => { r.at(-1).decision.mapping.candidateHashes[r[1].changeId] = '0'.repeat(64); }]) {
    const rows = structuredClone(reviews); mutate(rows); assert.throws(() => verifyFaqRelease(current, previous, rows));
  }
});
test('Rehashed releases cannot change approved answers or pretend retrieval happened at release time', async t => {
  const { reviews } = await fixture(t);
  for (const mutate of [r => { r.snapshot.faq[12].a += '虛構新規則'; }, r => { r.snapshot.faq[12].retrievedAt = '2026-10-26'; }]) {
    const release = structuredClone(current); mutate(release); release.snapshotHash = sha256(release.snapshot);
    assert.throws(() => verifyFaqRelease(release, previous, reviews));
  }
});
test('Audit uses the existing journal verification; tampered actor records fail before reporting approval', async t => {
  const { store } = await fixture(t); const path = join(store, 'audit.json');
  const rows = JSON.parse(readFileSync(path)); rows.at(-1).reviewer = 'FORGED'; writeFileSync(path, JSON.stringify(rows));
  assert.throws(() => listReviews(store), /審核紀錄驗證失敗/);
});
