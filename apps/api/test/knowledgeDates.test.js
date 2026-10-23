import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import seed from '../../../data/cardif_seed_data.json' with { type: 'json' };
import { projectPublicKnowledge } from '../../../shared/publicKnowledge.js';
import { knowledgeEntries, knowledgeSource, verifyKnowledgeSource } from '../../../shared/knowledge/index.js';
import { KnowledgeSourceSchema } from '../../../shared/journey.js';
import { getSources, searchPublicKnowledge } from '../src/services/knowledgeService.js';

for (const collection of ['forms', 'faq']) {
  test(`${collection}: explicit retrieval dates survive public projection; absent dates stay absent`, () => {
    const input = structuredClone(seed);
    input[collection][0].retrievedAt = '2026-09-17';
    input[collection][0].internal_notes = '合成非公開測試筆記';
    const projected = projectPublicKnowledge(input);
    assert.equal(projected[collection][0].retrievedAt, '2026-09-17');
    assert.equal(projected[collection][0].internal_notes, undefined);
    assert.equal(Object.hasOwn(projected[collection][1], 'retrievedAt'), false);
    assert.equal(projected.meta.crawled, seed.meta.crawled);
  });
  test(`${collection}: malformed or impossible entry dates are rejected`, () => {
    for (const invalid of ['2026-02-30', '2026-13-01', '2026-10-21T12:00:00Z', '', null, 20261021]) {
      const input = structuredClone(seed); input[collection][0].retrievedAt = invalid;
      assert.throws(() => projectPublicKnowledge(input));
    }
  });
}

test('explicit dates round-trip through browser-compatible parser, search index, sources and navigation', async t => {
  // Isolate synthetic dates from the formal seed and production module cache.
  const root = await mkdtemp(join(tmpdir(), 'navi-knowledge-dates-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  await cp(join(repo, 'shared'), join(root, 'shared'), { recursive: true });
  await symlink(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await mkdir(join(root, 'data'));
  const fixture = structuredClone(seed);
  fixture.forms[0].retrievedAt = '2026-09-17'; fixture.faq[0].retrievedAt = '2026-09-18';
  await writeFile(join(root, 'data/cardif_public_data.json'), JSON.stringify(projectPublicKnowledge(fixture)));
  const engine = await import(pathToFileURL(join(root, 'shared/knowledge/index.js')).href);
  for (const [id, date] of [[`form:${fixture.forms[0].id}`, '2026-09-17'], ['faq:1', '2026-09-18']]) {
    const entry = engine.searchKnowledge(id).results[0];
    assert.equal(entry.id, id); assert.equal(entry.retrievedAt, date); assert.equal(entry.dateBasis, 'entry');
    assert.equal(entry.destination.source.retrievedAt, date);
    const source = engine.knowledgeSource(entry);
    assert.equal(source.retrievedAt, date); assert.equal(Object.hasOwn(source, 'dateBasis'), false);
    assert.equal(engine.verifyKnowledgeSource(source), true);
    assert.equal(engine.verifyNavigationDestination(entry.destination, id), true);
    assert.equal(engine.verifyKnowledgeSource({ ...source, dateBasis: 'entry' }), false);
  }
  for (const id of [`form:${fixture.forms[1].id}`, 'faq:2']) {
    const entry = engine.getKnowledgeEntry(id);
    assert.equal(entry.retrievedAt, fixture.meta.crawled);
    assert.equal(entry.dateBasis, 'legacy_dataset_fallback');
  }
});

test('Backend sources preserve the existing strict source shape while search exposes date basis', () => {
  for (const entry of knowledgeEntries) {
    const source = knowledgeSource(entry), [backend] = getSources([entry.id]);
    assert.deepEqual(backend, source);
    assert.equal(searchPublicKnowledge(entry.id).results[0].retrievedAt, source.retrievedAt);
    assert.ok(['entry', 'legacy_dataset_fallback'].includes(entry.dateBasis));
    assert.equal(verifyKnowledgeSource(source), true);
    assert.equal(KnowledgeSourceSchema.safeParse(source).success, true);
    // Cached pre-release clients strictly validate this exact shape.
    assert.deepEqual(Object.keys(source).sort(), ['id', 'sourceId', 'title', 'section', 'type', 'isMock', 'url', 'sourceUrl', 'retrievedAt', 'navigationDestination'].sort());
    assert.equal(KnowledgeSourceSchema.safeParse({ ...source, dateBasis: 'entry' }).success, false);
  }
});
