import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import snapshot from '../../../../data/cardif_public_data.json' with { type: 'json' };
import { KnowledgeReleaseSchema, canonicalKnowledgeJson } from '../../../../shared/knowledge/version.js';
import { knowledgeEntries } from '../../../../shared/knowledge/index.js';

// Metadata only. Local review credentials and candidate/audit stores are never API resources.
export function getKnowledgeVersion({ allowSynthetic = false } = {}) {
  const version = snapshot.meta.knowledgeVersion;
  if (!version) return { knowledgeVersion: null, status: 'unversioned' };
  const release = KnowledgeReleaseSchema.parse(JSON.parse(readFileSync(new URL(`../../../../knowledge/releases/${version}.json`, import.meta.url), 'utf8')));
  if ((release.syntheticDemo && !(allowSynthetic && existsSync(new URL('../../../../.synthetic-knowledge-demo', import.meta.url)))) || release.knowledgeVersion !== version || release.snapshotHash !== createHash('sha256').update(canonicalKnowledgeJson(snapshot)).digest('hex')) throw Error('Knowledge release integrity check failed');
  if (release.sourceManifest.length !== knowledgeEntries.length || !release.sourceManifest.every((source, index) => ['sourceId', 'sourceUrl', 'retrievedAt'].every(key => source[key] === knowledgeEntries[index][key]))) throw Error('Knowledge source manifest mismatch');
  const { snapshot: _snapshot, ...manifest } = release;
  return manifest;
}
