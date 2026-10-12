import faq from '../../../../knowledge/faq.json' with { type: 'json' };
import sitemap from '../../../../knowledge/sitemap.json' with { type: 'json' };
import definitions from '../../../../knowledge/journeys.json' with { type: 'json' };
import { KnowledgeSourceSchema } from '../../../../shared/journey.js';
import { hospitalJourneyDefinition } from '../../../../shared/hospitalization.js';
import { cardifSource, getCardifRecord, retrieveCardifContext, isDecisionQuestion } from '../../../../knowledge/cardif.js';

export function getJourneyDefinition(serviceType) { return serviceType === 'hospitalization_claim' ? hospitalJourneyDefinition : definitions[serviceType] ?? null; }
export function getSources(ids) {
  const legacy = sitemap.filter(source => ids.includes(source.id)).map(source => KnowledgeSourceSchema.parse({ id: source.id, title: source.title, section: source.section, type: source.type === 'faq' ? 'prototype_faq' : 'prototype_guide', isMock: true, url: null }));
  return [...legacy, ...ids.map(getCardifRecord).filter(Boolean).map(item => KnowledgeSourceSchema.parse(cardifSource(item)))];
}
export function retrieveKnowledge(query) {
  const context = retrieveCardifContext(query);
  if (context) return { answer: context.answer, sources: getSources(context.sourceIds), isMock: false, found: true };
  // ponytail: curated JSON topics only; add ranked retrieval when the knowledge collection grows.
  const legacyQuery = faq.some(item => item.id === query) || /班機|航班|登機證|延誤|flight|boarding|delay certificate/i.test(query);
  const unrelatedService = !legacyQuery || isDecisionQuestion(query) && !faq.some(item => item.id === query);
  const topic = /延誤證明|delay certificate/i.test(query) ? 'why-delay' : /文件|document|登機證/i.test(query) ? 'documents' : /理賠|保障|coverage|claim/i.test(query) ? 'coverage' : null;
  const entry = unrelatedService ? null : faq.find(item => item.id === query || item.title === query || item.id === topic);
  return entry ? { answer: entry.answer, sources: getSources(entry.sourceIds), isMock: true, found: true } : { answer: '示範知識庫目前沒有這項資訊，請補充問題或由專員協助確認。', sources: [], isMock: true, found: false };
}

export function retrieveAnswerContext(query) {
  const context = retrieveCardifContext(query);
  if (context) return context;
  const retrieved = retrieveKnowledge(query);
  if (!retrieved.found) return null;
  return { answer: retrieved.answer, sourceIds: retrieved.sources.map(source => source.id), sources: retrieved.sources.map(source => ({ ...source, content: sitemap.find(record => record.id === source.id).content })) };
}
