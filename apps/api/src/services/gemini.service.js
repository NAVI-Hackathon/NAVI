import { z } from 'zod';
import { SYSTEM_PROMPT } from '../ai/prompts/intentPrompt.js';
import { DOCUMENT_PROMPT } from '../ai/prompts/documentPrompt.js';
import { KNOWLEDGE_PROMPT, HANDOFF_PROMPT } from '../ai/prompts/knowledgePrompt.js';
import { intentJsonSchema, documentJsonSchema, normalizeGeminiIntent, normalizeGeminiDocument, GroundedAnswerSchema, HandoffSelectionSchema } from '../ai/schemas.js';
import { assertLiveAllowed, createAIRequestBudget } from '../ai/costGuard.js';
import { createDurableQuota } from '../ai/durableQuota.js';
import { ApiError } from '../middleware/errorHandler.js';

// Native REST transport; inline media never leaves the backend through a public URL.
export function createGeminiProvider(config, fetchImpl = fetch, { budget = createAIRequestBudget(config.liveRequestLimit, { daily: config.production }), cache } = {}) {
  if (config.production && cache) throw new Error('Evaluation cache is prohibited in production');
  const quota = config.usageFile ? createDurableQuota({ file: config.usageFile, dailyLimit: config.dailyLimit, concurrency: config.maxConcurrent, timeoutMs: config.timeoutMs }) : null;
  const metadata = new Map();
  let rateLimitStreak = 0;
  async function generate(operation, prompt, parts, schema, validate, signal = AbortSignal.timeout(config.timeoutMs)) {
    if (!config.apiKey && !cache) throw new ApiError('AI_NOT_CONFIGURED', '目前暫時無法分析你的需求。請稍後再試。', 503, false);
    const started = performance.now();
    let schemaValid = false; let cacheHit = false;
    let errorCode; let lease;
    try {
      signal.throwIfAborted();
      const cached = await cache?.read(operation, prompt, parts, schema);
      if (cached) {
        try { const data = validate(cached); schemaValid = true; cacheHit = true; return data; }
        catch { /* Invalid stored output must not bypass schema validation. */ }
      }
      assertLiveAllowed(config);
      if (!config.apiKey) throw new ApiError('AI_NOT_CONFIGURED', '請設定 Backend Gemini API Key。', 503, false);
      if (fetchImpl === fetch && !quota) throw new ApiError('AI_USAGE_UNAVAILABLE', '免費使用額度記錄尚未設定，分析暫停。', 503, false);
      lease = quota?.acquire();
      budget.consume();
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: prompt }] }, contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: 2048,
            ...(config.thinkingLevel ? { thinkingConfig: { thinkingLevel: config.thinkingLevel } } : {}) },
        }),
      });
      if (response.status === 429) {
        quota?.block();
        if (++rateLimitStreak >= 2) budget.stop('AI_RATE_LIMITED');
        throw new ApiError('AI_RATE_LIMITED', '目前分析服務已達使用上限，請稍後再試或切換示範模式。', 429, rateLimitStreak < 2);
      }
      if (!response.ok) throw new ApiError('AI_PROVIDER_ERROR', '目前暫時無法完成分析。請稍後再試。', 502, response.status >= 500);
      rateLimitStreak = 0;
      const body = await response.json();
      const candidate = body.candidates?.[0];
      if (body.promptFeedback?.blockReason || ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST'].includes(candidate?.finishReason)) throw new ApiError('AI_SAFETY_REJECTION', '目前無法可靠分析這份資料，請補充說明或由專員協助。', 422, false);
      if (candidate?.finishReason !== 'STOP') throw new ApiError('AI_RESPONSE_INVALID', '分析結果尚不完整，請重新分析。');
      const text = candidate.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('');
      const raw = JSON.parse(text);
      const data = validate(raw);
      schemaValid = true;
      if (cache) { try { await cache.write(operation, prompt, parts, schema, raw); } catch { if (config.debugAi) console.info(JSON.stringify({ event: 'ai_cache_write_failed', operation })); } }
      return data;
    } catch (error) {
      errorCode = error.code ?? (error.name === 'ZodError' || error instanceof SyntaxError ? 'AI_RESPONSE_INVALID' : 'AI_PROVIDER_ERROR');
      if (signal.aborted) { errorCode = 'AI_ABORTED'; throw signal.reason; }
      if (error instanceof ApiError) throw error;
      if (error.name === 'ZodError' || error instanceof SyntaxError) throw new ApiError('AI_RESPONSE_INVALID', '分析結果尚不完整，請重新分析。');
      throw new ApiError('AI_PROVIDER_ERROR', '目前暫時無法完成分析。請稍後再試。');
    } finally {
      if (lease) quota.release(lease);
      const event = { provider: 'gemini', model: config.model, operation, latencyMs: Math.round(performance.now() - started), schemaValid, cacheHit, fallbackUsed: false, ...(errorCode ? { errorCode } : {}) };
      metadata.set(operation, event);
      if (config.debugAi) console.info(JSON.stringify({ event: 'ai_request', ...event }));
    }
  }
  return {
    mode: 'live', requiresPaidTier: false,
    getRequestBudget: budget.status,
    getDebugMetadata: () => Object.fromEntries([...metadata].map(([key, value]) => [key, { ...value }])),
    recordFallback(operation) { const value = metadata.get(operation); if (value) metadata.set(operation, { ...value, fallbackUsed: true }); },
    understandIntent: (message, signal) => generate('intent', SYSTEM_PROMPT, [{ text: message }], intentJsonSchema, normalizeGeminiIntent, signal),
    analyzeDocument: (upload, signal) => generate('document', DOCUMENT_PROMPT, [{ text: 'Extract the visible facts from this document.' }, { inlineData: { mimeType: upload.mimeType, data: upload.bytes.toString('base64') } }], documentJsonSchema, normalizeGeminiDocument, signal),
    answerKnowledge: (question, context, signal) => generate('knowledge', KNOWLEDGE_PROMPT, [{ text: JSON.stringify({ question, context }) }], z.toJSONSchema(GroundedAnswerSchema), raw => GroundedAnswerSchema.parse(raw), signal),
    summarizeHandoff: (knownFacts, signal) => generate('handoff', HANDOFF_PROMPT, [{ text: JSON.stringify({ knownFacts }) }], z.toJSONSchema(HandoffSelectionSchema), raw => HandoffSelectionSchema.parse(raw), signal),
  };
}
