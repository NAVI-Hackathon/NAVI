import { KnowledgeEvidenceSchema, KnowledgeEvidenceResponseSchema } from '../competition.js';
import { searchKnowledge, getKnowledgeEntry, knowledgeSource, verifyKnowledgeSource, verifyEvidenceSnippet } from './index.js';

// An advisory snapshot-age warning, never a policy validity or coverage rule.
export const SNAPSHOT_REVIEW_AFTER_DAYS = 90;
export function assessSnapshotDate(retrievedAt, now = new Date()) {
  const timestamp = Date.parse(`${retrievedAt}T00:00:00Z`);
  const today = Date.parse(now.toISOString().slice(0, 10));
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== retrievedAt || timestamp > today) return { status: 'invalid', ageDays: null };
  const ageDays = Math.floor((today - timestamp) / 86400000);
  return { status: ageDays > SNAPSHOT_REVIEW_AFTER_DAYS ? 'review_recommended' : 'snapshot_available', ageDays };
}
export function verifiedEvidence(sourceId, { preferredLines = [], now = new Date() } = {}) {
  const entry = getKnowledgeEntry(sourceId);
  const source = knowledgeSource(entry);
  if (!source || !verifyKnowledgeSource(source)) return null;
  const snapshot = assessSnapshotDate(source.retrievedAt, now);
  if (snapshot.status === 'invalid') return null;
  const excerpts = [...new Set([...preferredLines, ...entry.content.split('\n')])].filter(line => typeof line === 'string' && line.trim() && verifyEvidenceSnippet(sourceId, line)).slice(0, 3);
  if (!excerpts.length) return null;
  return KnowledgeEvidenceSchema.parse({ source, excerpts, snapshot, verificationScope: 'local_snapshot', liveWebsiteChecked: false });
}
export function searchVerifiedKnowledge(query, options) {
  const search = searchKnowledge(query);
  const results = search.results.map(entry => verifiedEvidence(entry.id, { ...options, preferredLines: search.highlights[entry.id] })).filter(Boolean);
  return KnowledgeEvidenceResponseSchema.parse({
    status: search.status === 'answered' && !results.length ? 'not_found' : search.status,
    ...(search.clarification ? { clarification: search.clarification } : {}),
    results, hotline: search.hotline,
    disclaimer: '摘錄已與本地官網資料快照核對，並非即時官網查核；不判斷保障適用或理賠結果。',
  });
}
