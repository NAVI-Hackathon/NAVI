import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { createAIProvider } from './ai/provider.js';
import { InMemoryJourneyRepository } from './repositories/inMemoryJourneyRepository.js';
import { createJourneyRouter } from './routes/journeys.js';
import { understandIntent } from './services/intent.service.js';
import { createTestSessions } from './middleware/testSession.js';
import { RequestSchema } from './schemas/intent.schema.js';
import { ApiError, errorHandler } from './middleware/errorHandler.js';

export function createApp(config, provider = createAIProvider(config), repository = new InMemoryJourneyRepository()) {
  if (config.production && !['live', 'unavailable'].includes(provider.mode)) throw new Error('Production provider must be live or unavailable');
  const sessions = createTestSessions(config, repository);
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxyLoopback) app.set('trust proxy', 'loopback');
  app.use(cors({
    credentials: true,
    origin(origin, callback) { callback(config.origins.includes(origin) || !origin ? null : new ApiError('ORIGIN_NOT_ALLOWED', '此來源無法存取服務。', 403), true); },
    methods: ['POST', 'GET', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type'], exposedHeaders: ['X-NAVI-AI-Mode'], maxAge: 600,
  }));
  app.use('/api', (req, res, next) => { res.set({ 'X-NAVI-AI-Mode': provider.mode === 'demo' ? 'demo' : provider.mode === 'unavailable' ? 'unavailable' : 'live', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); next(); });
  app.get('/api/health', (req, res) => res.json({ status: 'ok', aiProviderConfigured: Boolean(config.apiKey) }));
  // ponytail: in-memory limit is per process; use a shared store only when deploying multiple instances.
  const limiter = rateLimit({ windowMs: 60000, limit: config.rateLimit, standardHeaders: 'draft-8', legacyHeaders: false, handler: (req, res) => res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: '操作次數較多，請稍後再試。', retryable: true } }) });
  app.use('/api', limiter, express.json({ limit: '16kb' }));
  app.get('/api/ai/status', (req, res) => res.json({ mode: provider.mode ?? 'unavailable', available: provider.mode === 'live', syntheticOnly: Boolean(config.restrictedLive), demo: 'frontend_local_only', privacy: '黑客松原型，非正式理賠入口。請勿提供真實醫療、銀行或個人資料。' }));
  app.post('/api/test-sessions', sessions.activate);
  app.use('/api', (req, res, next) => {
    const path = req.path.toLowerCase().replace(/\/+$/, '');
    const ai = path === '/intelligence/understand' || path === '/analyze-intent' || path === '/knowledge/answer' || path === '/journeys';
    if (path.startsWith('/journeys/')) {
      try { sessions.authorize(req, req.path.split('/')[2]); } catch (error) { return next(error); }
    }
    if (ai && provider.mode === 'unavailable') return next(new ApiError('AI_UNAVAILABLE', '目前 AI 分析暫時無法使用，請稍後再試。請勿提供真實醫療或銀行資料。', 503, false));
    if (ai) return sessions.guard(req, res, next);
    next();
  });
  app.post('/api/intelligence/understand', async (req, res) => {
    const request = RequestSchema.safeParse(req.body);
    if (!request.success) throw new ApiError('INVALID_INPUT', '請描述你的情況，最多 2,000 字。', 400);
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    const result = await understandIntent(request.data.message, { provider, config, signal: controller.signal });
    sessions.remember(req, request.data.message, result.data);
    if (!controller.signal.aborted) res.json(result);
  });
  app.use('/api', createJourneyRouter({ config, provider, repository, sessions }));
  app.use((req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '找不到此服務。', retryable: false } }));
  app.use(errorHandler);
  return app;
}
