import { z } from 'zod';
const model = z.object({
  id: z.string().regex(/^gemini-[a-z0-9.-]+$/),
  capabilities: z.array(z.enum(['text', 'image', 'pdf', 'structured'])).min(1),
  tier: z.enum(['free', 'paid']), confirmed: z.boolean(),
  documentation: z.url().startsWith('https://ai.google.dev/'),
  maxRequestCostCents: z.number().int().positive().optional(),
}).strict().refine(m => m.tier !== 'paid' || m.maxRequestCostCents, 'Paid models require a conservative per-request cost reservation');
export function productConfig(env, primary, freeTierConfirmed) {
  if(env.NAVI_PUBLIC_APP_ORIGIN&&(!/^https:\/\/[^/]+$/.test(env.NAVI_PUBLIC_APP_ORIGIN)||!new URL(env.NAVI_PUBLIC_APP_ORIGIN).hostname))throw Error('Invalid public app origin');
  const enabled = env.NAVI_PRODUCT_MODE === 'true';
  if (env.MONGODB_DB_NAME && env.MONGODB_DATABASE && env.MONGODB_DB_NAME.trim() !== env.MONGODB_DATABASE.trim()) throw Error('Conflicting NAVI MongoDB database names');
  const integer = (name, fallback, min, max) => { const n = env[name] ? Number(env[name]) : fallback; if (!Number.isSafeInteger(n) || n < min || n > max) throw Error(`Invalid ${name}`); return n; };
  const models = z.array(model).min(1).max(6).parse(env.AI_MODELS_JSON ? JSON.parse(env.AI_MODELS_JSON) : [{ id: primary, capabilities: ['text','image','pdf','structured'], tier: 'free', confirmed: freeTierConfirmed, documentation: 'https://ai.google.dev/gemini-api/docs/models' }]);
  if (new Set(models.map(m => m.id)).size !== models.length) throw Error('Duplicate models');
  return { productMode: enabled, databasePath: env.NAVI_PRIVATE_STATE_PATH || '', mongoUri:env.MONGODB_URI||'', mongoDatabase:(env.MONGODB_DB_NAME||env.MONGODB_DATABASE||'').trim(), authRequired:env.NAVI_AUTH_REQUIRED==='true', authRequireVerifiedEmail:env.NAVI_AUTH_REQUIRE_VERIFIED_EMAIL==='true', dataEncryptionKey: env.NAVI_DATA_ENCRYPTION_KEY || '',
    dataRetentionMs: integer('NAVI_RETENTION_DAYS', 30, 1, 90) * 86400000,
    sessionTtlMs: integer('NAVI_SESSION_DAYS', 30, 1, 90) * 86400000,
    sessionRateLimit: integer('AI_SESSION_REQUESTS_PER_MINUTE', 10, 1, 120),
    queueLimit: integer('AI_QUEUE_LIMIT', 30, 1, 200), queueWaitMs: integer('AI_QUEUE_TIMEOUT_MS', 10000, 100, 30000),
    requestsPerMinute: integer('AI_REQUESTS_PER_MINUTE', 12, 1, 1000),
    requestTimeoutMs: integer('AI_REQUEST_TIMEOUT_MS', 40000, 1000, 90000),
    routeAttempts: integer('AI_ROUTE_MAX_ATTEMPTS', 3, 1, 4), modelPolicies: models,
    paidAuthorization: env.AI_PAID_AUTHORIZATION || '', paidBudgetCents: integer('AI_PAID_DAILY_BUDGET_CENTS', 0, 0, 100000),
    billingConfirmed: env.GEMINI_BILLING_CONFIRMED === 'true', adminToken: env.NAVI_ADMIN_TOKEN || '',
    knowledgeStore: env.NAVI_KNOWLEDGE_STORE || '', smtpHost:env.SMTP_HOST||'',smtpUser:env.SMTP_USER||'',smtpPassword:env.SMTP_PASSWORD||'',smtpPort:integer('SMTP_PORT',587,1,65535),mailFrom:env.MAIL_FROM||'',publicAppOrigin:env.NAVI_PUBLIC_APP_ORIGIN||'https://app.navitw.com',
  };
}
