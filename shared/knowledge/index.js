import { NavigationTargetSchema, KnowledgeSourceSchema } from '../journey.js';
import { cardif, claimsUrl, formsUrl, sitePaths, officialSource, kebab, formAnchor } from '../cardif.js';
import { hasNegatedHospitalization } from '../hospitalization.js';
import { queryProfile, rewrite, tokens, TYPE_CUES, SERVICE_CUES, RANKING, isDecisionQuestion } from './vocabulary.js';
const seedServices = cardif.services, seedForms = cardif.forms, seedFaq = cardif.faq;
const seedClaimDocuments = cardif.claim_document_requirements, seedClaimRules = cardif.claim_general_rules;
const hotline = cardif.contacts.hotline, FORMS_PAGE_URL = formsUrl, claimByMail = { url: claimsUrl };
const sitePathFor = url => sitePaths[url] ?? null;

// Knowledge index and search over data/cardif_seed_data.json. Every answer is quoted from the
// data file and points at the matching spot on the mock site; nothing is generated.

const LABEL_MAX = 40;
const clip = (text, max = LABEL_MAX) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
export const typeLabels = { service: '服務說明', form: '表單', faq: '常見問題', claim_documents: '理賠應備文件', claim_rule: '理賠規定', glossary: '名詞解釋' };

function destination(kind, path, anchor, label, sourceUrl, retrievedAt) {
  return NavigationTargetSchema.parse({ kind, path, anchor, label: clip(label), source: officialSource(sourceUrl, retrievedAt) });
}

function serviceEntry(service) {
  const path = sitePathFor(service.url);
  if (!path) throw new Error(`No mock-site page for service ${service.id}`);
  const details = [
    ['辦理方式', service.channels],
    ['申請時間', service.apply_time ? [service.apply_time] : []],
    ['生效時間', service.effective_time ? [service.effective_time] : []],
    ['應備文件', service.documents],
    ['注意事項', service.notes],
    ['線上辦理', service.online_available ? [service.online_available] : []],
    ['線上服務條件', service.online_requirements ?? []],
  ].filter(([, items]) => items.length > 0).map(([label, items]) => ({ label, items }));
  return {
    id: `service:${service.id}`, type: 'service', title: service.name, category: service.category,
    summary: '', // the detail lists (辦理方式、應備文件…) are the answer
    details, requiresLogin: Boolean(service.requires_login), precheckQuestions: service.precheck_questions ?? [],
    destination: destination('page', path, `service-${kebab(service.id)}`, `查看${service.name}`, service.url, service.retrievedAt),
    relatedIds: (service.related_forms ?? []).map(id => `form:${id}`),
    search: { title: service.name, keywords: [...(service.keywords ?? []), service.category], body: [...details.flatMap(d => [d.label, ...d.items]), ...(service.precheck_questions ?? [])].join(' ') },
  };
}

function formEntry(form) {
  return {
    id: `form:${form.id}`, type: 'form', title: form.name, category: form.id.startsWith('claim_') ? '理賠服務表單' : '保全服務表單',
    summary: form.note ?? `可在「常用表單下載」頁找到這份表單。`,
    details: [], requiresLogin: false,
    destination: destination('form', '/services/forms', formAnchor(form.id), `下載${form.name}`, FORMS_PAGE_URL),
    relatedIds: seedServices.filter(s => s.related_forms?.includes(form.id)).map(s => `service:${s.id}`),
    search: { title: form.name, keywords: ['表單', '下載'], body: form.note ?? '' },
  };
}

function faqEntry(faq, index) {
  return {
    id: `faq:${index + 1}`, type: 'faq', title: faq.q, category: '常見問題', summary: faq.a, details: [], requiresLogin: false,
    destination: destination('faq', '/faq', `faq-${index + 1}`, '查看常見問題', faq.source),
    relatedIds: seedServices.filter(s => s.url === faq.source).map(s => `service:${s.id}`),
    search: { title: faq.q, keywords: [], body: faq.a },
  };
}

function claimDocumentsEntry([claimType, documents], index) {
  return {
    id: `claim-doc:${index + 1}`, type: 'claim_documents', title: `${claimType}理賠應備文件`, category: '理賠',
    summary: `申請${claimType}理賠需要準備：`, details: [{ label: '應備文件', items: documents }], requiresLogin: false,
    destination: destination('page', '/services/claims', `claim-doc-${index + 1}`, `查看${claimType}應備文件`, claimByMail.url),
    relatedIds: ['form:claim_1.1.1', 'service:claim_by_mail'],
    search: { title: `${claimType}理賠應備文件`, keywords: [claimType, '理賠文件', '準備什麼'], body: documents.join(' ') },
  };
}

function claimRuleEntry(rule, index) {
  return {
    id: `claim-rule:${index + 1}`, type: 'claim_rule', title: clip(rule, 30), category: '理賠', summary: rule, details: [], requiresLogin: false,
    destination: destination('page', '/services/claims', `claim-rule-${index + 1}`, '查看理賠申請規定', claimByMail.url),
    relatedIds: [],
    search: { title: '', keywords: ['理賠規定'], body: rule },
  };
}

function glossaryEntry(term) {
  return {
    id: `glossary:${term.id}`, type: 'glossary', title: term.term, category: term.category, summary: term.definition,
    details: [], requiresLogin: false, relatedIds: [],
    destination: destination('page', '/glossary', `glossary-term-${term.id}`, `查看${term.term}`, term.sourceUrl, term.retrievedAt),
    search: { title: term.term, keywords: term.keywords, body: term.definition },
  };
}

const entries = [
  ...cardif.glossary.map(glossaryEntry),
  ...seedServices.map(serviceEntry),
  ...seedForms.map(formEntry),
  ...seedFaq.map(faqEntry),
  ...Object.entries(seedClaimDocuments).map(claimDocumentsEntry),
  ...seedClaimRules.map(claimRuleEntry),
];
// Only literal snapshot strings are evidence. UI labels and summaries are presentation.
const evidenceLines = entry => {
  if (entry.type === 'service') return [entry.title, ...entry.details.flatMap(d => d.items), ...entry.precheckQuestions];
  if (entry.type === 'form') { const form = seedForms.find(f => `form:${f.id}` === entry.id); return [form.name, ...(form.note ? [form.note] : [])]; }
  if (entry.type === 'claim_documents') return entry.details.flatMap(d => d.items);
  return [entry.summary];
};
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const knowledgeEntries = freeze(entries.map(entry => ({
  ...entry, sourceId: entry.id, sourceUrl: entry.destination.source.url, retrievedAt: entry.destination.source.retrievedAt,
  sourceType: 'public_site_snapshot', navigationDestination: entry.destination,
  content: evidenceLines(entry).join('\n'), keywords: entry.search.keywords,
})));
const byId = new Map(knowledgeEntries.map(entry => [entry.id, entry]));

// ---- Tokenising -------------------------------------------------------------------------------
// Chinese has no spaces: compare overlapping two-character pieces ("保單借款" → 保單 單借 借款),
// after splitting on filler words that carry no meaning for search.
const indexed = knowledgeEntries.map(entry => ({
  entry,
  title: tokens(entry.search.title),
  keywords: tokens(entry.search.keywords.join(' ')),
  body: tokens(entry.search.body),
  phrases: entry.search.keywords.map(k => rewrite(k).replace(/ /g, '')).filter(k => k.length >= 2),
  compactTitle: rewrite(entry.search.title).replace(/ /g, ''),
}));
// Rare pieces (e.g. 受益) say more than common ones (e.g. 保單, 申請).
const documentFrequency = new Map();
for (const doc of indexed) for (const t of new Set([...doc.title, ...doc.keywords, ...doc.body])) documentFrequency.set(t, (documentFrequency.get(t) ?? 0) + 1);
// Pieces that never appear in the data (e.g. 我小 in 改成我小孩) cannot match anything; keep their weight low.
const idf = t => (documentFrequency.has(t) ? Math.log(1 + knowledgeEntries.length / documentFrequency.get(t)) : 1);

// What the question asks for nudges the answer type: "表單在哪下載" prefers the form itself.
function scoreEntry(doc, query, queryTokens) {
  let score = 0;
  let matched = 0;
  let total = 0;
  let distinctive = 0;
  for (const t of queryTokens) {
    const weight = idf(t);
    total += weight;
    const hit = doc.title.has(t) ? RANKING.title : doc.keywords.has(t) ? RANKING.keyword : doc.body.has(t) ? RANKING.body : 0;
    if (hit) { matched += weight; score += weight * hit; distinctive = Math.max(distinctive, weight); }
  }
  const compact = rewrite(query).replace(/ /g, '');
  // Asking for an item by its exact name ("保險金申請書") beats items that merely contain it.
  const titled = doc.compactTitle.length >= 4 && (compact.includes(doc.compactTitle) ? RANKING.exactTitle : doc.compactTitle.includes(compact) && compact.length >= 4 ? RANKING.partialTitle : 0);
  const phrase = titled > 0 || doc.phrases.some(p => compact.includes(p));
  if (phrase) { score += titled || RANKING.phrase; matched = Math.max(matched, total * RANKING.phraseCoverage); }
  for (const cue of TYPE_CUES) if (cue.type === doc.entry.type && cue.pattern.test(query)) score *= cue.boost;
  return { score, coverage: total ? matched / total : 0, specific: phrase || distinctive >= RANKING.minDistinctive };
}

/** The detail lines of an entry that share the most pieces with the question (e.g. 正本 → the 10-day originals rule). */
function relevantLines(entry, queryTokens, max = 3) {
  return entry.details
    .flatMap(detail => detail.items)
    .map(line => {
      const pieces = tokens(line);
      let score = 0;
      for (const t of queryTokens) if (pieces.has(t)) score += idf(t);
      return { line, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(r => r.line);
}

/**
 * Search the official-site knowledge.
 * `highlights[entryId]` lists the entry's lines most related to the question, for short answers.
 * @returns {{ status: 'answered'|'not_found'|'out_of_scope', results: object[], related: object[], highlights: Record<string, string[]>, hotline: string }}
 */
export function searchKnowledge(query, { limit = 3 } = {}) {
  const text = String(query ?? '').trim().slice(0, 500);
  const none = status => ({ status, results: [], related: [], highlights: {}, hotline });
  if (isDecisionQuestion(text)) return none('out_of_scope');
  if (queryProfile(text).unsupported) return none('not_found');
  const queryTokens = tokens(text);
  if (queryTokens.size === 0) return none('not_found');

  const profile = queryProfile(text);
  const outpatient = profile.outpatient || hasNegatedHospitalization(text);
  const exact = byId.get(text);
  const ranked = indexed
    .filter(doc => doc.entry.type !== 'claim_documents' || (!outpatient && !profile.inpatient) || doc.entry.id === (outpatient ? 'claim-doc:1' : 'claim-doc:2'))
    .map(doc => {
      const scored = scoreEntry(doc, text, queryTokens);
      for (const cue of SERVICE_CUES) if (cue.id === doc.entry.id && cue.pattern.test(text) && !cue.exclude?.test(text)) scored.score += RANKING.contextPhrase;
      if (outpatient && doc.entry.id === 'claim-doc:1') {
        scored.score = scored.score * RANKING.outpatientBoost + RANKING.contextPhrase;
        scored.coverage = Math.max(scored.coverage, RANKING.phraseCoverage);
        scored.specific = true;
      }
      else if (profile.inpatient && doc.entry.id === 'claim-doc:2') scored.score *= RANKING.inpatientBoost;
      if (exact === doc.entry) return { entry: doc.entry, score: Number.MAX_SAFE_INTEGER, coverage: 1, specific: true };
      return { entry: doc.entry, ...scored };
    })
    .filter(r => r.specific && r.score >= RANKING.minScore && r.coverage >= RANKING.minCoverage)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  if (ranked.length === 0) return none('not_found');

  const best = ranked[0].score;
  const results = ranked.filter(r => r.score >= best * RANKING.resultRatio).slice(0, Math.max(1, Math.min(3, Number.isInteger(limit) ? limit : 3))).map(r => r.entry);
  const shown = new Set(results.map(r => r.id));
  const related = results.flatMap(r => r.relatedIds).filter(id => !shown.has(id) && byId.has(id) && (shown.add(id), true)).slice(0, 3).map(id => byId.get(id));
  const highlights = Object.fromEntries(results.map(r => [r.id, relevantLines(r, queryTokens)]));
  return { status: 'answered', results, related, highlights, hotline };
}

export const getKnowledgeEntry = id => byId.get(id) ?? null;

export function verifyNavigationDestination(value, sourceId) {
  const parsed = NavigationTargetSchema.safeParse(value);
  if (!parsed.success) return false;
  const canonical = byId.get(sourceId)?.destination;
  const target = parsed.data;
  return Boolean(canonical && ['kind', 'path', 'anchor', 'label'].every(k => target[k] === canonical[k]) && ['url', 'title', 'retrievedAt'].every(k => target.source[k] === canonical.source[k]));
}
export function verifyEvidenceSnippet(sourceId, snippet) {
  const item = byId.get(sourceId);
  return typeof snippet === 'string' && Boolean(item && item.content.split('\n').includes(snippet));
}
export function knowledgeSource(item) {
  const record = item && byId.get(item.id);
  if (!record || record.title !== item.title || record.sourceId !== item.sourceId || record.content !== item.content || !verifyNavigationDestination(item.navigationDestination, item.id) || item.sourceUrl !== record.sourceUrl || item.retrievedAt !== record.retrievedAt) return null;
  return {
    id: record.id, sourceId: record.id, title: record.title, section: record.id, type: 'public_site_snapshot', isMock: false,
    url: record.sourceUrl, sourceUrl: record.sourceUrl, retrievedAt: record.retrievedAt, navigationDestination: record.destination,
  };
}
// Whole evidence lines only, with the historical 1800-character answer bound.
export function retrieveKnowledgeContext(query) {
  const search = searchKnowledge(query);
  if (search.status !== 'answered') return null;
  const lines = [], sources = [];
  let length = 0;
  for (const item of search.results) {
    const evidence = item.content.split('\n');
    const priority = [...(search.highlights[item.id] ?? []), ...evidence];
    const included = [...new Set(priority)].filter(line => verifyEvidenceSnippet(item.id, line) && length + line.length + 1 <= 1800 && (length += line.length + 1));
    if (included.length) { lines.push(...included); sources.push({ ...knowledgeSource(item), content: item.content }); }
  }
  return sources.length ? { answer: lines.join('\n'), sources, sourceIds: sources.map(s => s.id), isMock: false } : null;
}

export function verifyKnowledgeSource(value) {
  const parsed = KnowledgeSourceSchema.safeParse(value);
  if (!parsed.success || parsed.data.type !== 'public_site_snapshot') return false;
  const source = parsed.data, record = byId.get(source.id);
  return Boolean(record && source.title === record.title && source.section === record.id && source.sourceUrl === record.sourceUrl && source.retrievedAt === record.retrievedAt && verifyNavigationDestination(source.navigationDestination, source.id));
}
