import { ollamaConfig } from './ollama.js';
import { productConfig } from './product.js';
import { FREE_TIER_MODEL, DEFAULT_LIVE_REQUEST_LIMIT } from '../ai/costGuard.js';
import { DEFAULT_CONFIDENCE_THRESHOLD } from '../../../../shared/intelligence.js';

const DEFAULT_GEMINI_MODEL = FREE_TIER_MODEL;

function numeric(env, name, fallback, min, max) {
  const value = env[name] === undefined || env[name] === '' ? fallback : Number(env[name]);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${name} configuration`);
  return value;
}
export function loadConfig(env = process.env) {
  if (env.ALLOW_PAID_AI && env.ALLOW_PAID_AI !== 'false' && env.NAVI_PRODUCT_MODE !== 'true') throw new Error('Paid AI is prohibited in NAVI');
  const aiMode = env.AI_MODE?.trim() || 'demo';
  if (!['demo', 'live', 'unavailable'].includes(aiMode)) throw new Error('Invalid AI_MODE configuration');
  if (env.NODE_ENV === 'production' && (!env.AI_MODE?.trim() || aiMode === 'demo')) throw new Error('Production requires explicit AI_MODE=live or unavailable');
  const aiProvider = env.AI_PROVIDER?.trim() || 'gemini';
  if (!['gemini', 'ollama'].includes(aiProvider)) throw new Error('Invalid AI_PROVIDER configuration');
  const local = aiProvider === 'ollama' && aiMode === 'live';
  const ollama = local ? ollamaConfig(env) : {};
  const model = local ? ollama.ollamaModel : env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  if (local ? model !== ollama.ollamaModel : !/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Invalid AI model configuration');
  const product = productConfig(local ? { ...env, AI_MODELS_JSON: undefined } : env, model, !local && env.GEMINI_FREE_TIER_CONFIRMED === 'true', local ? 'ollama' : 'gemini');
  if (!local && !product.productMode && env.NODE_ENV === 'production' && aiMode === 'live' && (!env.GEMINI_API_KEY?.trim() || env.GEMINI_FREE_TIER_CONFIRMED !== 'true' || model !== FREE_TIER_MODEL || !env.AI_USAGE_FILE?.startsWith('/') || (env.AI_PUBLIC_SYNTHETIC !== 'true' && (env.NAVI_TEST_SESSION_TOKEN?.trim().length ?? 0) < 32))) throw new Error('Production Live configuration is incomplete or unapproved');
  if (!local && product.productMode && env.NODE_ENV === 'production' && aiMode === 'live' && (!env.GEMINI_API_KEY?.trim() || !product.modelPolicies.some(p => p.id === model && p.confirmed && (p.tier === 'free' ? env.GEMINI_FREE_TIER_CONFIRMED === 'true' : env.ALLOW_PAID_AI === 'true' && product.billingConfirmed && product.paidAuthorization.length >= 32 && product.paidBudgetCents > 0)))) throw new Error('Production Live configuration is incomplete or unapproved');
  const requestLimit = numeric(env, 'LIVE_AI_REQUEST_LIMIT', env.MAX_LIVE_EVAL_REQUESTS_PER_RUN ? Number(env.MAX_LIVE_EVAL_REQUESTS_PER_RUN) : DEFAULT_LIVE_REQUEST_LIMIT, 1, 1000);
  const publicSynthetic = env.AI_PUBLIC_SYNTHETIC === 'true';
  const restrictedLive = local || env.NODE_ENV === 'production' || env.AI_SYNTHETIC_TEST_ONLY === 'true';
  if (local && !product.productMode && (publicSynthetic || env.TRUST_PROXY_LOOPBACK === 'true' || (env.NAVI_TEST_SESSION_TOKEN?.trim().length ?? 0) < 32)) throw new Error('Non-product Ollama requires a restricted operator sandbox');
  if (local && product.productMode && !env.NAVI_DATA_ENCRYPTION_KEY) throw new Error('Product Ollama requires encrypted persistence');
  const aiMaxAttempts = numeric(env, 'AI_MAX_ATTEMPTS', restrictedLive ? 1 : 2, 1, 2);
  if (restrictedLive && aiMaxAttempts !== 1 && !product.productMode) throw new Error('Restricted Live requests cannot automatically retry');
  const syntheticDocumentHashes = (env.AI_SYNTHETIC_DOCUMENT_SHA256 || '').split(',').map(value => value.trim()).filter(Boolean);
  if (syntheticDocumentHashes.some(value => !/^[a-f0-9]{64}$/.test(value))) throw new Error('Invalid synthetic document fingerprint');
  if (publicSynthetic && env.NODE_ENV !== 'production' && env.AI_SYNTHETIC_TEST_ONLY !== 'true') throw new Error('Public synthetic access requires session isolation');
  if (!Number.isSafeInteger(requestLimit)) throw new Error('Invalid live AI request limit');
  for (const name of ['AI_DAILY_REQUEST_LIMIT', 'AI_MAX_CONCURRENT', 'AI_MAX_ATTEMPTS', 'AI_SESSION_REQUEST_LIMIT']) if (env[name] && !Number.isSafeInteger(Number(env[name]))) throw new Error(`Invalid ${name} configuration`);
  return {
    ...product, ...ollama, aiMode, aiProvider,
    production: env.NODE_ENV === 'production',
    restrictedLive,
    publicSynthetic, syntheticDocumentHashes,
    sessionToken: env.NAVI_TEST_SESSION_TOKEN?.trim() || '',
    usageFile: env.AI_USAGE_FILE?.trim() || '',
    dailyLimit: numeric(env, 'AI_DAILY_REQUEST_LIMIT', product.productMode ? 400 : 12, 1, product.productMode ? 100000 : 100),
    sessionRequestLimit: numeric(env, 'AI_SESSION_REQUEST_LIMIT', product.productMode ? 0 : 6, product.productMode ? 0 : 1, product.productMode ? 10000 : 20),
    maxConcurrent: numeric(env, 'AI_MAX_CONCURRENT', local ? 1 : product.productMode ? 3 : 1, 1, product.productMode ? 8 : 2),
    aiMaxAttempts,
    apiKey: local ? '' : env.GEMINI_API_KEY?.trim() || '', model,
    thinkingLevel: !local && model === FREE_TIER_MODEL ? 'MINIMAL' : undefined,
    allowPaidAI: !local && product.productMode && env.ALLOW_PAID_AI === 'true', freeTierConfirmed: !local && env.GEMINI_FREE_TIER_CONFIRMED === 'true',
    ci: Boolean(env.CI && !['false', '0'].includes(env.CI.toLowerCase())),
    liveRequestLimit: requestLimit,
    rateLimitBackoffMs: 1000,
    port: numeric(env, 'PORT', 3001, 1, 65535), host: env.HOST || '127.0.0.1',
    trustProxyLoopback: env.TRUST_PROXY_LOOPBACK === 'true',
    origins: (env.WEB_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(s => s.trim()).filter(Boolean),
    confidenceThreshold: numeric(env, 'INTENT_CONFIDENCE_THRESHOLD', DEFAULT_CONFIDENCE_THRESHOLD, 0, 1),
    journeyConfidenceThreshold: numeric(env, 'JOURNEY_CONFIDENCE_THRESHOLD', 0.75, 0.55, 1),
    humanReviewThreshold: numeric(env, 'HUMAN_REVIEW_THRESHOLD', 0.55, 0, 0.55),
    timeoutMs: local ? numeric(env, 'OLLAMA_TIMEOUT_MS', 45000, 1000, 80000) : numeric(env, 'AI_TIMEOUT_MS', 10000, 1000, 12000),
    debugAi: env.AI_DEBUG_METADATA === 'true',
    rateLimit: numeric(env, 'API_RATE_LIMIT', product.productMode ? 90 : 30, 10, 1000),
  };
}
