import { HandoffSelectionSchema } from '../ai/schemas.js';
import { requestValidatedAI } from './providerRequest.js';
import { ApiError } from '../middleware/errorHandler.js';

export async function enhanceHandoff(summary, { provider, config, signal }) {
  const knownFacts = [
    { id: 'issue', text: `事件：${summary.issue}` }, { id: 'summary', text: summary.summary },
    { id: 'reason', text: summary.reason },
    ...summary.collected.map((text, index) => ({ id: `collected-${index}`, text: `已收集：${text}` })),
    ...summary.missing.map((text, index) => ({ id: `missing-${index}`, text: `尚待確認：${text}` })),
    ...(summary.consistencyIssues ?? []).map((issue, index) => ({ id: `issue-${index}`, text: issue.message })),
  ];
  const template = () => ({ ...summary, narrative: knownFacts.map(fact => fact.text).join('\n'), summaryMode: 'template' });
  if (!provider.summarizeHandoff) return template();
  try {
    const result = await requestValidatedAI(async combined => {
      const selection = HandoffSelectionSchema.parse(await provider.summarizeHandoff(knownFacts, combined));
      const required = ['issue', 'summary', 'reason', ...knownFacts.filter(fact => fact.id.startsWith('issue-')).map(fact => fact.id)];
      if (selection.factIds.some(id => !knownFacts.some(fact => fact.id === id)) || required.some(id => !selection.factIds.includes(id))) throw new ApiError('AI_RESPONSE_INVALID', '摘要包含未確認的資料。');
      return [...new Set(selection.factIds)].map(id => knownFacts.find(fact => fact.id === id).text).join('\n');
    }, { config, signal });
    return { ...summary, narrative: result, summaryMode: 'selected_facts' };
  } catch (error) {
    if (error.code === 'AI_SESSION_LIMIT_REACHED' || error.code?.startsWith('TEST_SESSION_')) throw error;
    if (['AI_UNAVAILABLE', 'AI_USAGE_UNAVAILABLE', 'AI_DAILY_LIMIT_REACHED', 'AI_BUSY', 'AI_RATE_LIMITED', 'AI_REQUEST_BUDGET_REACHED', 'FREE_TIER_NOT_CONFIRMED', 'LIVE_AI_DISABLED_IN_CI', 'PAID_AI_DISABLED'].includes(error.code)) throw error;
    if (signal?.aborted || error.code === 'REQUEST_CANCELLED' || !(error instanceof ApiError)) throw error;
    provider.recordFallback?.('handoff');
    return template();
  }
}
