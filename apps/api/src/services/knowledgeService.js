import faq from '../../../../knowledge/faq.json' with { type: 'json' };
import sitemap from '../../../../knowledge/sitemap.json' with { type: 'json' };
import definitions from '../../../../knowledge/journeys.json' with { type: 'json' };
import { KnowledgeSourceSchema } from '../../../../shared/journey.js';
import { hospitalJourneyDefinition } from '../../../../shared/hospitalization.js';
import { cardifSource, getCardifRecord, retrieveCardifContext, isDecisionQuestion } from '../../../../knowledge/cardif.js';
import { searchKnowledge } from '../../../../shared/knowledge/index.js';

// Public search has no legacy/prototype fallback and never calls an AI provider.
export const searchPublicKnowledge = (query, options) => searchKnowledge(query, options);

export function getJourneyDefinition(serviceType) { return serviceType === 'hospitalization_claim' ? hospitalJourneyDefinition : definitions[serviceType] ?? null; }
export function getSources(ids) {
  const legacy = sitemap.filter(source => ids.includes(source.id)).map(source => KnowledgeSourceSchema.parse({ id: source.id, title: source.title, section: source.section, type: source.type === 'faq' ? 'prototype_faq' : 'prototype_guide', isMock: true, url: null }));
  return [...legacy, ...ids.map(getCardifRecord).filter(Boolean).map(item => KnowledgeSourceSchema.parse(cardifSource(item)))];
}
export function retrieveKnowledge(query) {
  const search = searchPublicKnowledge(query);
  const context = retrieveCardifContext(query);
  if (context) return { ...search, answer: context.answer, sources: getSources(context.sourceIds), isMock: false, found: true };
  // Archived JSON topics are an explicit compatibility layer, not public snapshot search.
  const legacyQuery = faq.some(item => item.id === query) || /班機|航班|登機證|延誤|flight|boarding|delay certificate/i.test(query);
  const legacyDisclaimer = /^班機延誤可以理賠嗎[？?]?$/.test(query);
  const unrelatedService = !legacyQuery || isDecisionQuestion(query) && !faq.some(item => item.id === query) && !legacyDisclaimer;
  const topic = /延誤證明|delay certificate/i.test(query) ? 'why-delay' : /文件|document|登機證/i.test(query) ? 'documents' : /理賠|保障|coverage|claim/i.test(query) ? 'coverage' : null;
  const entry = unrelatedService ? null : faq.find(item => item.id === query || item.title === query || item.id === topic);
  // Archived flight disclaimer stays accessible for old tests; never enters public search.
  return entry ? { answer: entry.answer, sources: getSources(entry.sourceIds), isMock: true, found: true } : { ...search, answer: '目前提供的資料不足以確認，請補充問題或由專員協助。', sources: [], isMock: true, found: false };
}

export function retrieveAnswerContext(query) {
  const context = retrieveCardifContext(query);
  if (context) return context;
  const retrieved = retrieveKnowledge(query);
  if (!retrieved.found) return null;
  return { answer: retrieved.answer, sourceIds: retrieved.sources.map(source => source.id), sources: retrieved.sources.map(source => ({ ...source, content: sitemap.find(record => record.id === source.id).content })) };
}
