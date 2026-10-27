import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { listReviews, validateRelease, sha256 } from './lifecycle.js';

// Read-only audit. Approval authority is checked by listReviews' existing signed journal.
export function verifyFaqRelease(release, previous, reviews) {
  const { snapshot, engine } = validateRelease(release);
  const oldRelease = validateRelease(previous), old = oldRelease.snapshot;
  assert.equal(release.previousRelease, previous.knowledgeVersion);
  for (const oldEntry of oldRelease.engine.knowledgeEntries) {
    const current = engine.getKnowledgeEntry(oldEntry.id); assert.ok(current, 'Existing source removed');
    for (const key of ['id', 'title', 'content', 'sourceUrl', 'retrievedAt']) assert.equal(current[key], oldEntry[key], 'Existing source changed');
    assert.equal(current.destination.path, oldEntry.destination.path); assert.equal(current.destination.anchor, oldEntry.destination.anchor);
  }
  const selected = release.approvedChangeIds.map(id => {
    const row = reviews.find(r => r.changeId === id);
    assert.ok(row && row.status === 'APPROVED' && row.decision?.status === 'APPROVED' && !row.decision.synthetic, 'Missing genuine approval');
    assert.ok(row.decision.reviewer && row.decision.reason && row.decision.at, 'Incomplete review record');
    return row;
  });
  const whole = selected.find(row => row.category === 'Requires Manual Review');
  assert.ok(whole?.decision.wholePageConfirmed && !whole.decision.reviewOnly, 'Whole-page review missing');
  const mapping = whole.decision.mapping;
  assert.equal(mapping.operation, 'append_faq');
  assert.deepEqual([...mapping.changeIds].sort(), [...release.approvedChangeIds].sort());
  assert.equal(mapping.baseSnapshotHash, previous.snapshotHash);
  const questions = [...whole.context.matchAll(/^\* ([^\n]+)\n/gm)];
  const spans = questions.map((q, i) => ({ id: `faq:${old.faq.length + i + 1}`, start: q.index,
    end: questions[i + 1]?.index ?? whole.context.length, q: q[1].trim(), a: whole.context.slice(q.index + q[0].length, questions[i + 1]?.index ?? whole.context.length).trim() }));
  assert.deepEqual(mapping.entries, spans.map(({ q, a }) => ({ q, a })));
  assert.deepEqual(snapshot.faq.slice(0, old.faq.length), old.faq, 'Existing FAQ changed');
  assert.equal(snapshot.faq.length - old.faq.length, spans.length);
  const faq = spans.map((span, i) => {
    const entry = snapshot.faq[old.faq.length + i];
    assert.equal(entry.q, span.q); assert.equal(entry.a, span.a);
    assert.equal(entry.source, whole.sourceUrl); assert.equal(entry.retrievedAt, whole.retrievedAt.slice(0, 10));
    assert.equal(mapping.anchorsConfirmed[i], span.id.replace(':', '-'));
    const record = engine.getKnowledgeEntry(span.id);
    assert.equal(engine.searchKnowledge(span.id).results[0].id, span.id);
    assert.ok(record.content.split('\n').every(text => engine.verifyEvidenceSnippet(span.id, text)));
    assert.equal(record.destination.anchor, mapping.anchorsConfirmed[i]);
    return { sourceId: span.id, title: span.q, sourceUrl: record.sourceUrl, retrievedAt: record.retrievedAt, publishedAt: null,
      contentSha256: sha256(record.content), questionSha256: sha256(span.q), answerSha256: sha256(span.a), navigationDestination: record.destination };
  });
  const candidates = selected.map(row => {
    const { decision, ...original } = row; delete original.status;
    assert.equal(sha256(original), decision.candidateHash);
    assert.equal(mapping.candidateHashes[row.changeId], decision.candidateHash);
    assert.equal(row.sourceUrl, whole.sourceUrl); assert.equal(row.context, whole.context);
    assert.equal(sha256(row.context), row.normalizedContentSha256);
    let sourceIds = [];
    if (row.new) {
      assert.equal(sha256(row.new.text), row.new.sha256);
      let index = whole.context.indexOf(row.new.text); assert.ok(index >= 0);
      while (index >= 0) {
        sourceIds.push(...spans.filter(s => index < s.end && index + row.new.text.length > s.start).map(s => s.id));
        index = whole.context.indexOf(row.new.text, index + 1);
      }
    } else sourceIds = spans.map(s => s.id);
    return { candidateId: row.changeId, category: row.category, status: row.status, reviewedAt: decision.at,
      wholePageConfirmed: Boolean(decision.wholePageConfirmed), paragraphSha256: row.new?.sha256 ?? null,
      normalizedPageSha256: row.normalizedContentSha256, sourceUrl: row.sourceUrl, retrievedAt: row.retrievedAt,
      sourceIds: [...new Set(sourceIds)], mappingScope: !row.new ? 'whole_page_review' : sourceIds.length ? 'literal_span_overlap' : 'page_heading_context_only' };
  });
  return { knowledgeVersion: release.knowledgeVersion, previousVersion: release.previousRelease, snapshotHash: release.snapshotHash,
    releasedAt: release.releasedAt, datasetCrawled: snapshot.meta.crawled, publishedAt: null,
    approvedItems: selected.length, addedParagraphs: selected.filter(row => row.category === 'Added').length,
    wholePageReviews: selected.filter(row => row.category === 'Requires Manual Review').length,
    addedFaqs: faq.length, sourceCount: release.sourceManifest.length, previousEntriesPreserved: oldRelease.engine.knowledgeEntries.length, candidates, faq,
    privateReviewMaterialExported: false, limitations: ['The local signed journal proves local integrity, not an independent insurer approval.', 'Dates are retrieval/release metadata, not official publication dates.', 'No official website was fetched; this verifies the approved snapshot.'] };
}
async function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const json = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
  const publicData = await json('data/cardif_public_data.json');
  const release = await json(`knowledge/releases/${publicData.meta.knowledgeVersion}.json`);
  assert.equal(sha256(publicData), release.snapshotHash);
  const previous = await json(`knowledge/releases/${release.previousRelease}.json`);
  const report = { at: new Date().toISOString(), gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    authority: 'existing HMAC journal and candidate hash verification via listReviews; read only',
    ...verifyFaqRelease(release, previous, listReviews(resolve(root, 'data/private/knowledge'))) };
  const out = resolve(root, 'artifacts/knowledge-release-audit', Date.now().toString()); await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: out, ...report }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
