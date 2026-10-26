import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createNavigationService } from '../src/services/navigationService.js';
import { getKnowledgeVersion } from '../src/services/knowledgeVersionService.js';
import { knowledgeEntries } from '../../../shared/knowledge/index.js';
import { auditNavigation } from '../../../scripts/evidence/navigation-audit.js';

test('production navigation rejects missing, stale, malformed and mismatched source/DOM manifests', async t => {
  const root = await mkdtemp(join(tmpdir(), 'navi-nav-audit-')); t.after(() => rm(root, { recursive: true, force: true }));
  const pages = new Map();
  for (const entry of knowledgeEntries) {
    const { path, anchor } = entry.destination;
    pages.set(path, (pages.get(path) ?? '') + `<section data-tour-id="${anchor}"></section>`);
  }
  for (const [path, html] of pages) { const file = join(root, `${path === '/' ? 'index' : path.slice(1)}.html`); await mkdir(dirname(file), { recursive: true }); await writeFile(file, html); }
  const manifest = await auditNavigation(root); assert.deepEqual(manifest.issues, []); assert.equal(manifest.plans, knowledgeEntries.length);
  const input = { sourceId: 'service:change_address' };
  assert.equal(createNavigationService({ production: true, navigationManifest: manifest })(input).status, 'answered');
  for (const bad of [{}, { ...manifest, snapshotHash: '0'.repeat(64) }, { ...manifest, issues: [{ type: 'MISSING_TARGET' }] }, { ...manifest, targets: [] }, { ...manifest, targets: manifest.targets.map(t => ({ ...t, sourceId: 'forged' })) }]) {
    assert.throws(() => createNavigationService({ production: true, navigationManifest: bad })(input), { code: 'NAVIGATION_TARGET_UNAVAILABLE' });
  }
  assert.throws(() => createNavigationService({ production: true }, () => { throw Error('missing'); })(input), { code: 'NAVIGATION_TARGET_UNAVAILABLE' });
  const missing = join(root, 'services/policy-change.html'); await writeFile(missing, '<main>anchor removed</main>');
  const report = await auditNavigation(root); assert.ok(report.issues.some(i => i.type === 'MISSING_TARGET' && i.anchor === 'service-change-address'));
  assert.equal(getKnowledgeVersion().knowledgeVersion, manifest.knowledgeVersion);
});
