import { NavigationTargetSchema } from '../../../../shared/journey.js';
import {
  FORMS_PAGE_URL, claimByMail, hotline, officialSource, seedClaimDocuments, seedClaimRules, seedFaq, seedForms, seedServices, sitePathFor,
} from '../content/cardifData.js';

// Knowledge index and search over data/cardif_seed_data.json. Every answer is quoted from the
// data file and points at the matching spot on the mock site; nothing is generated.

const LABEL_MAX = 40;
const clip = (text, max = LABEL_MAX) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const kebab = id => id.replace(/[_.\s]+/g, '-').toLowerCase();

// Same anchor rules as apps/mock-site/components/site/tour-ids.ts.
// Forms with one row per policy type have no base row; point at the first version.
const VERSIONED_FORMS = new Set(['form_contract_change', 'form_policyholder_change']);
const formAnchor = id => {
  const base = id.startsWith('form_') ? kebab(id) : `form-${kebab(id)}`;
  return VERSIONED_FORMS.has(id) ? `${base}-investment` : base;
};

export const typeLabels = { service: '服務說明', form: '表單', faq: '常見問題', claim_documents: '理賠應備文件', claim_rule: '理賠規定' };

function destination(kind, path, anchor, label, sourceUrl) {
  return NavigationTargetSchema.parse({ kind, path, anchor, label: clip(label), source: officialSource(sourceUrl) });
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
  ].filter(([, items]) => items.length > 0).map(([label, items]) => ({ label, items }));
  return {
    id: `service:${service.id}`, type: 'service', title: service.name, category: service.category,
    summary: '', // the detail lists (辦理方式、應備文件…) are the answer
    details, requiresLogin: Boolean(service.requires_login),
    destination: destination('page', path, `service-${kebab(service.id)}`, `查看${service.name}`, service.url),
    relatedIds: (service.related_forms ?? []).map(id => `form:${id}`),
    search: { title: service.name, keywords: [...(service.keywords ?? []), service.category], body: [...service.documents, ...service.notes, ...service.channels].join(' ') },
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

export const knowledgeEntries = [
  ...seedServices.map(serviceEntry),
  ...seedForms.map(formEntry),
  ...seedFaq.map(faqEntry),
  ...Object.entries(seedClaimDocuments).map(claimDocumentsEntry),
  ...seedClaimRules.map(claimRuleEntry),
];
const byId = new Map(knowledgeEntries.map(entry => [entry.id, entry]));

// ---- Tokenising -------------------------------------------------------------------------------
// Chinese has no spaces: compare overlapping two-character pieces ("保單借款" → 保單 單借 借款),
// after splitting on filler words that carry no meaning for search.
const FILLER = /請問|我想要|我想|想要|我要|我的|要怎麼|怎麼|如何|可以|需要|什麼|哪裡|在哪|一下|有沒有|是不是|應該|哪些|幫我|告訴我|幾號|做了|[嗎呢吧啊了的]/g;
// Everyday words → the wording the official site uses.
const SYNONYMS = [[/癌症/g, '防癌'], [/過世|死亡|往生/g, '身故'], [/殘廢/g, '失能'], [/看診|看醫生/g, '門診'], [/電話/g, '專線']];
const normalise = text => text.toLowerCase().replace(/臺/g, '台').replace(/[\s\p{P}\p{S}]+/gu, ' ');
// 「沒有住院」 says what did NOT happen; searching for 住院 there would surface the wrong claim type.
const NEGATED = /(?:沒有|沒|未曾|未|不曾|不用|不是|非)(?:住院|住過院|入院)/g;
const rewrite = text => SYNONYMS.reduce((out, [pattern, word]) => out.replace(pattern, word), normalise(text).replace(NEGATED, ' '));

function tokens(text) {
  const out = new Set();
  for (const segment of rewrite(text).replace(FILLER, ' ').split(' ')) {
    for (const word of segment.match(/[a-z0-9]{2,}/g) ?? []) out.add(word);
    const han = segment.replace(/[a-z0-9]/g, '');
    for (let i = 0; i + 1 < han.length; i++) out.add(han.slice(i, i + 2));
  }
  return out;
}

const indexed = knowledgeEntries.map(entry => ({
  entry,
  title: tokens(entry.search.title),
  keywords: tokens(entry.search.keywords.join(' ')),
  body: tokens(entry.search.body),
  phrases: entry.search.keywords.map(k => normalise(k).replace(/ /g, '')).filter(k => k.length >= 2),
  compactTitle: rewrite(entry.search.title).replace(/ /g, ''),
}));
// Rare pieces (e.g. 受益) say more than common ones (e.g. 保單, 申請).
const documentFrequency = new Map();
for (const doc of indexed) for (const t of new Set([...doc.title, ...doc.keywords, ...doc.body])) documentFrequency.set(t, (documentFrequency.get(t) ?? 0) + 1);
// Pieces that never appear in the data (e.g. 我小 in 改成我小孩) cannot match anything; keep their weight low.
const idf = t => (documentFrequency.has(t) ? Math.log(1 + knowledgeEntries.length / documentFrequency.get(t)) : 1);

// What the question asks for nudges the answer type: "表單在哪下載" prefers the form itself.
const TYPE_CUES = [
  { pattern: /表單|申請書|下載|填寫/, type: 'form', boost: 1.4 },
  { pattern: /多久|幾天|幾次|收不到|鎖住|密碼|條件/, type: 'faq', boost: 1.3 },
  { pattern: /文件|準備|證明|資料/, type: 'claim_documents', boost: 1.2 },
];

// Guardrails: NAVI never recommends products or judges claims (AGENTS.md 產品護欄).
const ADVICE = /買.{0,6}(險|保單)|推薦|划算|該買|買哪|要不要買|適合.*(保單|保險)|(能|可以|會)不(能|可以|會)?賠|(能|可以|會)賠嗎|賠不賠|賠多少|理賠金額|核准|拒賠/;

const MIN_COVERAGE = 0.45;
const MIN_SCORE = 2.5;
// At least one matched piece must be specific: 保單 or 保險 alone match almost everything.
const MIN_DISTINCTIVE = 2.2;

function scoreEntry(doc, query, queryTokens) {
  let score = 0;
  let matched = 0;
  let total = 0;
  let distinctive = 0;
  for (const t of queryTokens) {
    const weight = idf(t);
    total += weight;
    const hit = doc.title.has(t) ? 3 : doc.keywords.has(t) ? 2.5 : doc.body.has(t) ? 1 : 0;
    if (hit) { matched += weight; score += weight * hit; distinctive = Math.max(distinctive, weight); }
  }
  const compact = rewrite(query).replace(/ /g, '');
  // Asking for an item by its exact name ("保險金申請書") beats items that merely contain it.
  const titled = doc.compactTitle.length >= 4 && (compact.includes(doc.compactTitle) ? 8 : doc.compactTitle.includes(compact) && compact.length >= 4 ? 3 : 0);
  const phrase = titled > 0 || doc.phrases.some(p => compact.includes(p));
  if (phrase) { score += titled || 6; matched = Math.max(matched, total * 0.8); }
  for (const cue of TYPE_CUES) if (cue.type === doc.entry.type && cue.pattern.test(query)) score *= cue.boost;
  return { score, coverage: total ? matched / total : 0, specific: phrase || distinctive >= MIN_DISTINCTIVE };
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
  const text = String(query ?? '').trim().slice(0, 300);
  const none = status => ({ status, results: [], related: [], highlights: {}, hotline });
  if (ADVICE.test(text)) return none('out_of_scope');
  const queryTokens = tokens(text);
  if (queryTokens.size === 0) return none('not_found');

  const ranked = indexed
    .map(doc => ({ entry: doc.entry, ...scoreEntry(doc, text, queryTokens) }))
    .filter(r => r.specific && r.score >= MIN_SCORE && r.coverage >= MIN_COVERAGE)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return none('not_found');

  const best = ranked[0].score;
  const results = ranked.filter(r => r.score >= best * 0.6).slice(0, limit).map(r => r.entry);
  const shown = new Set(results.map(r => r.id));
  const related = results.flatMap(r => r.relatedIds).filter(id => !shown.has(id) && byId.has(id) && (shown.add(id), true)).slice(0, 3).map(id => byId.get(id));
  const highlights = Object.fromEntries(results.map(r => [r.id, relevantLines(r, queryTokens)]));
  return { status: 'answered', results, related, highlights, hotline };
}

export const getKnowledgeEntry = id => byId.get(id) ?? null;
