import { ApiError } from '../middleware/errorHandler.js';

export const FREE_TIER_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_LIVE_REQUEST_LIMIT = 12;
export function assertFreeProvider(provider) {
  if (provider.requiresPaidTier) throw new ApiError('PAID_AI_DISABLED', 'NAVI 不允許載入付費 AI 服務。', 503, false);
  return provider;
}
export function assertLiveAllowed(config) {
  if (config.allowPaidAI || config.model !== FREE_TIER_MODEL) throw new ApiError('PAID_AI_DISABLED', '目前模型不在 NAVI 免費服務允許清單內。', 503, false);
  if (config.ci) throw new ApiError('LIVE_AI_DISABLED_IN_CI', 'CI 僅允許本地與示範測試。', 503, false);
  if (!config.freeTierConfirmed) throw new ApiError('FREE_TIER_NOT_CONFIRMED', '請先確認 API Key 所屬專案為 Free Tier，且未啟用 Billing。', 503, false);
}
// ponytail: budget is per provider process; share a counter only if multiple API workers are deployed.
export function createAIRequestBudget(limit = DEFAULT_LIVE_REQUEST_LIMIT) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid live AI request limit');
  let used = 0; let stopped = null;
  return {
    consume() {
      if (stopped) throw new ApiError(stopped, '分析服務已暫停，請稍後再試或使用示範模式。', stopped === 'AI_RATE_LIMITED' ? 429 : 503, false);
      if (used >= limit) { stopped = 'AI_REQUEST_BUDGET_REACHED'; throw new ApiError(stopped, '已達本次分析服務使用上限，請使用示範模式。', 429, false); }
      used++;
    },
    stop(code = 'AI_RATE_LIMITED') { stopped = code; },
    status: () => ({ limit, used, remaining: Math.max(0, limit - used), stopped }),
  };
}
