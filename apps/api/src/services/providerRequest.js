import { setTimeout as backoff } from 'node:timers/promises';
import { ApiError } from '../middleware/errorHandler.js';

// Enforce a deadline even if a provider implementation fails to honor its AbortSignal.
export async function withProviderDeadline(task, { config, signal }) {
  const deadline = AbortSignal.timeout(config.timeoutMs);
  const combined = signal ? AbortSignal.any([deadline, signal]) : deadline;
  let onAbort;
  try {
    combined.throwIfAborted();
    const cancelled = new Promise((resolve, reject) => {
      onAbort = () => reject(combined.reason);
      combined.addEventListener('abort', onAbort, { once: true });
    });
    return await Promise.race([task(combined), cancelled]);
  } catch (error) {
    if (deadline.aborted) throw new ApiError('AI_TIMEOUT', '分析已逾時，請重新嘗試；若持續無法完成，請使用示範模式或由專員協助。', 504);
    if (signal?.aborted) throw new ApiError('REQUEST_CANCELLED', '分析已取消。', 499, false);
    throw error;
  } finally {
    if (onAbort) combined.removeEventListener('abort', onAbort);
  }
}

// One shared deadline covers both attempts; no nested retries or hidden demo substitution.
export function requestValidatedAI(task, options) {
  return withProviderDeadline(async signal => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await task(signal); }
      catch (error) {
        if (signal?.aborted) throw error;
        const invalid = error.name === 'ZodError' || error.code === 'AI_RESPONSE_INVALID';
        const transient = error.code === 'AI_PROVIDER_ERROR' && error.retryable;
        const rateLimited = error.code === 'AI_RATE_LIMITED' && error.retryable;
        if (!invalid && !transient && !rateLimited) throw error;
        if (attempt === 1) {
          if (invalid) throw new ApiError('AI_RESPONSE_INVALID', '分析結果尚不完整，請重新分析。');
          throw error;
        }
        if (rateLimited) await backoff(options.config.rateLimitBackoffMs ?? 1000, undefined, { signal });
      }
    }
  }, options);
}
