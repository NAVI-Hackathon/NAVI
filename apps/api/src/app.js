import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { createAIProvider } from './ai/provider.js';
import { InMemoryJourneyRepository } from './repositories/inMemoryJourneyRepository.js';
import { createJourneyRouter } from './routes/journeys.js';
import { understandIntent } from './services/intent.service.js';
import { RequestSchema } from './schemas/intent.schema.js';
import { ApiError, errorHandler } from './middleware/errorHandler.js';

export function createApp(config, provider = createAIProvider(config), repository = new InMemoryJourneyRepository()) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({
    origin(origin, callback) { callback(config.origins.includes(origin) || !origin ? null : new ApiError('ORIGIN_NOT_ALLOWED', '此來源無法存取服務。', 403), true); },
    methods: ['POST', 'GET', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type'], exposedHeaders: ['X-NAVI-AI-Mode'], maxAge: 600,
  }));
  app.use('/api', (req, res, next) => { res.set('X-NAVI-AI-Mode', provider.mode === 'demo' ? 'demo' : 'live'); next(); });
  app.get('/api/health', (req, res) => res.json({ status: 'ok', aiProviderConfigured: Boolean(config.apiKey) }));
  // ponytail: in-memory limit is per process; use a shared store only when deploying multiple instances.
  const limiter = rateLimit({ windowMs: 60000, limit: config.rateLimit, standardHeaders: 'draft-8', legacyHeaders: false, handler: (req, res) => res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: '操作次數較多，請稍後再試。', retryable: true } }) });
  app.use('/api', limiter, express.json({ limit: '16kb' }));
  app.post('/api/intelligence/understand', async (req, res) => {
    const request = RequestSchema.safeParse(req.body);
    if (!request.success) throw new ApiError('INVALID_INPUT', '請描述你的情況，最多 2,000 字。', 400);
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    const result = await understandIntent(request.data.message, { provider, config, signal: controller.signal });
    if (!controller.signal.aborted) res.json(result);
  });
  app.use('/api', createJourneyRouter({ config, provider, repository }));
  app.use((req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '找不到此服務。', retryable: false } }));
  app.use(errorHandler);
  return app;
}
