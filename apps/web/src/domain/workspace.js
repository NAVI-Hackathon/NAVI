import { documentSpecs } from '../mocks/hospitalClaim.js';

// What the service workspace shows is read from the journey the server returned (formal mode) or the
// local demo engine (/demo, same contract). Nothing here decides an insurance rule: it only sorts the
// journey's own fields into the sections of the workspace.

/**
 * 'full': a service with a document workflow (住院醫療理賠) — timeline, documents, readiness score.
 * 'compact': everything else (services NAVI only guides, specialist review) — no stages, no percentage.
 */
export function workspaceProfile(snapshot) {
  const { journey, context } = snapshot;
  return context.kind === 'hospital' && journey.supported !== false && journey.currentStage !== 'HUMAN_REVIEW' ? 'full' : 'compact';
}

/** Document slots of the journey, in the order of its requirements (the server's list, not a fixed pair). */
export function documentTypesOf(journey) {
  return journey.requirements.map(requirement => requirement.id).filter(id => id in documentSpecs);
}

const documentTitle = document => documentSpecs[document.documentType]?.title ?? document.filename;

/** Readiness wording without a score: what the server's stage means for the user. */
export function stageLabel(journey) {
  return {
    EVIDENCE_COLLECTION: '正在準備資料',
    READY_FOR_REVIEW: '可以進行確認',
    READY_TO_PROCEED: '資料初步準備完成',
    HUMAN_REVIEW: '需要專員確認',
    SERVICE_IDENTIFIED: '已找到相關服務',
  }[journey.currentStage] ?? '旅程已建立';
}

/**
 * Conditions still open on this journey: conflicts between documents, documents kept after a correction
 * (to confirm, not counted) and documents with fields waiting for review. Each item quotes the server's
 * own state; an empty list means the server reports nothing open, not that the service is approved.
 */
export function openConditions(journey) {
  const conflicts = (journey.consistencyIssues ?? []).map(issue => ({ id: `issue-${issue.type}`, tone: 'warn', text: issue.message }));
  const revalidate = journey.documents.filter(document => document.requiresRevalidation)
    .map(document => ({ id: `revalidate-${document.id}`, tone: 'warn', text: `${documentTitle(document)}是修正需求前上傳的，需要重新上傳確認，目前不計入準備度。` }));
  const review = journey.documents.filter(document => document.status === 'needs_review' && !document.requiresRevalidation)
    .map(document => ({ id: `review-${document.id}`, tone: 'info', text: `${documentTitle(document)}有欄位待人工確認。` }));
  return [...conflicts, ...revalidate, ...review];
}

/** Requirements split for the checklist: done, still needed, and the ones that depend on the case. */
export function requirementGroups(journey) {
  return {
    done: journey.requirements.filter(r => r.status === 'verified'),
    pending: journey.requirements.filter(r => r.status !== 'verified' && r.required),
    optional: journey.requirements.filter(r => r.status !== 'verified' && !r.required),
  };
}

/**
 * Official sources behind this journey, deduplicated: snapshot entries (with verifiable excerpts) first,
 * then plain official pages. Prototype guide entries are not official and are left out.
 */
export function officialSourcesOf(journey) {
  const seen = new Set();
  const out = [];
  for (const source of journey.sources ?? []) {
    if (source.isMock || seen.has(source.url)) continue;
    seen.add(source.url);
    out.push({ key: source.id, sourceId: source.sourceId, fallback: { url: source.url, title: source.title, retrievedAt: source.retrievedAt } });
  }
  for (const source of journey.officialSources ?? []) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    out.push({ key: source.url, sourceId: null, fallback: source });
  }
  return out;
}
