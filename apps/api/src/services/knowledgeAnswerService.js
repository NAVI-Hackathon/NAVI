import { GroundedAnswerSchema } from '../ai/schemas.js';
import { retrieveAnswerContext, getSources } from './knowledgeService.js';
import { requestValidatedAI } from './providerRequest.js';
import { ApiError } from '../middleware/errorHandler.js';

export const INSUFFICIENT_ANSWER = '目前提供的資料不足以確認。';
const insufficient = () => ({ answer: INSUFFICIENT_ANSWER, confidence: 0, sources: [], supported: false, isMock: true, answerMode: 'insufficient_information' });
export function validateGroundedAnswer(raw, context) {
  const data = GroundedAnswerSchema.parse(raw);
  if (!data.supported) {
    if (data.sourceIds.length || data.answer !== INSUFFICIENT_ANSWER) throw new ApiError('AI_RESPONSE_INVALID', '回答缺少可靠依據。');
    return data;
  }
  const pieces = [{ text: context.answer, sourceIds: context.sourceIds }, ...context.sources.flatMap(source => [source.content, ...source.content.split('\n')].map(text => ({ text, sourceIds: [source.id] })))];
  const selected = data.answer.split(/\n+/).map(text => pieces.find(piece => piece.text === text.trim()));
  const sourceIds = [...new Set(data.sourceIds)];
  // ponytail: extractive answers only; allow free paraphrase once claim-level grounding has evaluations.
  if (!sourceIds.length || sourceIds.some(id => !context.sourceIds.includes(id)) || selected.some(piece => !piece || !piece.sourceIds.some(id => sourceIds.includes(id))) || sourceIds.some(id => !selected.some(piece => piece?.sourceIds.includes(id)))) throw new ApiError('AI_RESPONSE_INVALID', '回答缺少可靠依據。');
  return { ...data, sourceIds };
}
export async function answerKnowledge(question, { provider, config, signal }) {
  const context = retrieveAnswerContext(question);
  if (!context) return insufficient();
  try {
    if (!provider.answerKnowledge) throw new ApiError('AI_GENERATION_UNAVAILABLE', '目前無法產生說明。');
    const result = await requestValidatedAI(async combined => validateGroundedAnswer(await provider.answerKnowledge(question, context, combined), context), { config, signal });
    if (!result.supported) return insufficient();
    return { answer: result.answer, confidence: result.confidence, sources: getSources(result.sourceIds), supported: true, isMock: context.isMock !== false, answerMode: provider.mode === 'demo' ? 'demo' : 'grounded_extract' };
  } catch (error) {
    if (error.code === 'AI_SESSION_LIMIT_REACHED' || error.code?.startsWith('TEST_SESSION_')) throw error;
    if (['AI_UNAVAILABLE', 'AI_USAGE_UNAVAILABLE', 'AI_DAILY_LIMIT_REACHED', 'AI_BUSY', 'AI_RATE_LIMITED', 'AI_REQUEST_BUDGET_REACHED', 'FREE_TIER_NOT_CONFIRMED', 'LIVE_AI_DISABLED_IN_CI', 'PAID_AI_DISABLED'].includes(error.code)) throw error;
    if (signal?.aborted || error.code === 'REQUEST_CANCELLED' || !(error instanceof ApiError)) throw error;
    // Non-critical wording can fall back to the actual retrieved template, never to demo facts.
    provider.recordFallback?.('knowledge');
    return { answer: context.answer, confidence: 0, sources: getSources(context.sourceIds), supported: true, isMock: context.isMock !== false, answerMode: 'retrieval_template' };
  }
}
