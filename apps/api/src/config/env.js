import { FREE_TIER_MODEL, DEFAULT_LIVE_REQUEST_LIMIT } from '../ai/costGuard.js';
import { DEFAULT_CONFIDENCE_THRESHOLD } from '../../../../shared/intelligence.js';

const DEFAULT_GEMINI_MODEL = FREE_TIER_MODEL;

function numeric(env, name, fallback, min, max) {
  const value = env[name] === undefined || env[name] === '' ? fallback : Number(env[name]);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${name} configuration`);
  return value;
}
export function loadConfig(env = process.env) {
  if (env.ALLOW_PAID_AI && env.ALLOW_PAID_AI !== 'false') throw new Error('Paid AI is prohibited in NAVI');
  const aiMode = env.AI_MODE?.trim() || 'demo';
  if (!['demo', 'live', 'unavailable'].includes(aiMode)) throw new Error('Invalid AI_MODE configuration');
  const model = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Invalid GEMINI_MODEL configuration');
  const requestLimit = numeric(env, 'LIVE_AI_REQUEST_LIMIT', env.MAX_LIVE_EVAL_REQUESTS_PER_RUN ? Number(env.MAX_LIVE_EVAL_REQUESTS_PER_RUN) : DEFAULT_LIVE_REQUEST_LIMIT, 1, 1000);
  if (!Number.isSafeInteger(requestLimit)) throw new Error('Invalid live AI request limit');
  for (const name of ['AI_DAILY_REQUEST_LIMIT', 'AI_MAX_CONCURRENT', 'AI_MAX_ATTEMPTS']) if (env[name] && !Number.isSafeInteger(Number(env[name]))) throw new Error(`Invalid ${name} configuration`);
  return {
    aiMode,
    production: env.NODE_ENV === 'production',
    restrictedLive: env.NODE_ENV === 'production' || env.AI_SYNTHETIC_TEST_ONLY === 'true',
    sessionToken: env.NAVI_TEST_SESSION_TOKEN?.trim() || '',
    usageFile: env.AI_USAGE_FILE?.trim() || '',
    dailyLimit: numeric(env, 'AI_DAILY_REQUEST_LIMIT', 12, 1, 100),
    maxConcurrent: numeric(env, 'AI_MAX_CONCURRENT', 1, 1, 2),
    aiMaxAttempts: numeric(env, 'AI_MAX_ATTEMPTS', env.NODE_ENV === 'production' || env.AI_SYNTHETIC_TEST_ONLY === 'true' ? 1 : 2, 1, 2),
    apiKey: env.GEMINI_API_KEY?.trim() || '', model,
    thinkingLevel: model === FREE_TIER_MODEL ? 'MINIMAL' : undefined,
    allowPaidAI: false, freeTierConfirmed: env.GEMINI_FREE_TIER_CONFIRMED === 'true',
    ci: Boolean(env.CI && !['false', '0'].includes(env.CI.toLowerCase())),
    liveRequestLimit: requestLimit,
    rateLimitBackoffMs: 1000,
    port: numeric(env, 'PORT', 3001, 1, 65535), host: env.HOST || '127.0.0.1',
    trustProxyLoopback: env.TRUST_PROXY_LOOPBACK === 'true',
    origins: (env.WEB_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(s => s.trim()).filter(Boolean),
    confidenceThreshold: numeric(env, 'INTENT_CONFIDENCE_THRESHOLD', DEFAULT_CONFIDENCE_THRESHOLD, 0, 1),
    journeyConfidenceThreshold: numeric(env, 'JOURNEY_CONFIDENCE_THRESHOLD', 0.75, 0.55, 1),
    humanReviewThreshold: numeric(env, 'HUMAN_REVIEW_THRESHOLD', 0.55, 0, 0.55),
    timeoutMs: numeric(env, 'AI_TIMEOUT_MS', 10000, 1000, 12000),
    debugAi: env.AI_DEBUG_METADATA === 'true',
    rateLimit: 30,
  };
}
