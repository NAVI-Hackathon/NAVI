import { assertFreeProvider, assertLiveAllowed } from './costGuard.js';
import { createDemoProvider } from './demoProvider.js';
import { createGeminiProvider } from '../services/gemini.service.js';
import { ApiError } from '../middleware/errorHandler.js';

export function createUnavailableProvider() {
  const unavailable = async () => { throw new ApiError('AI_UNAVAILABLE', '目前 AI 分析暫時無法使用，請稍後再試。示範模式可使用合成資料體驗。', 503, false); };
  return { mode: 'unavailable', requiresPaidTier: false, understandIntent: unavailable, analyzeDocument: unavailable, answerKnowledge: unavailable, summarizeHandoff: unavailable };
}
export function createAIProvider(config) {
  // Public production never serves fixtures, even if a legacy --demo flag is still present.
  if (config.aiMode === 'unavailable' || (config.production && config.aiMode === 'demo')) return createUnavailableProvider();
  if (config.aiMode === 'demo') return assertFreeProvider(createDemoProvider());
  if (config.restrictedLive) {
    try { assertLiveAllowed(config); } catch { return createUnavailableProvider(); }
    if (!config.apiKey || !config.usageFile || (!config.publicSynthetic && config.sessionToken.length < 32)) return createUnavailableProvider();
  }
  return assertFreeProvider(createGeminiProvider(config));
}
