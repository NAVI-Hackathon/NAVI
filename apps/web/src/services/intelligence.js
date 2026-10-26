import { validateUnderstanding, demoFallback } from '../domain/intelligence.js';
import { MAX_MESSAGE_LENGTH } from '../../../../shared/intelligence.js';

export class IntelligenceError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export const analysisErrors = {
  AI_TIMEOUT: ['分析時間較長', '這次沒有完成分析，請稍後按「重新分析」再試一次。'],
  NETWORK_ERROR: ['目前暫時無法分析你的需求', '請確認網路連線，或稍後再試一次。'],
  AI_RESPONSE_INVALID: ['分析結果尚不完整', '請重新分析，或補充你的情況後再試一次。'],
  INVALID_INPUT: ['請再確認輸入內容', '請描述你的情況，最多 2,000 字。'],
  RATE_LIMITED: ['分析次數較多', '請稍候一分鐘，再重新分析。'],
  DEFAULT: ['目前暫時無法分析你的需求', '請稍後再試一次。'],
};
export async function understandIntent(message, {
  signal, fetchImpl = fetch, timeoutMs = 12000,
  baseUrl = import.meta.env?.VITE_API_BASE_URL || '',
  enableFallback = import.meta.env?.VITE_ENABLE_DEMO_FALLBACK === 'true',
} = {}) {
  if (typeof message !== 'string' || !message.trim() || message.trim().length > MAX_MESSAGE_LENGTH) throw new IntelligenceError('INVALID_INPUT');
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/intelligence/understand`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: message.trim() }), signal: combined,
    });
    let result;
    try { result = await response.json(); } catch {
      if(response.ok) throw new IntelligenceError('AI_RESPONSE_INVALID');
    }
    if (!response.ok) throw new IntelligenceError(typeof result?.error?.code === 'string' ? result.error.code : response.status >= 500 ? 'API_UNAVAILABLE' : 'API_ERROR');
    try { return validateUnderstanding(result); } catch { throw new IntelligenceError('AI_RESPONSE_INVALID'); }
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    const failure = deadline.aborted ? new IntelligenceError('AI_TIMEOUT') : error instanceof IntelligenceError ? error : new IntelligenceError('NETWORK_ERROR');
    // Input and security failures are never masked by the demonstration backup.
    if (enableFallback && ['NETWORK_ERROR', 'API_UNAVAILABLE', 'AI_TIMEOUT', 'AI_PROVIDER_ERROR', 'AI_NOT_CONFIGURED', 'AI_RESPONSE_INVALID'].includes(failure.code)) {
      const fallback = demoFallback(message);
      if (fallback) return fallback;
    }
    throw failure;
  }
}

export async function waitForAnalysis(ms, signal) {
  signal.throwIfAborted();
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    function abort() { clearTimeout(timer); cleanup(); reject(signal.reason); }
    signal.addEventListener('abort', abort, { once: true });
  });
}
