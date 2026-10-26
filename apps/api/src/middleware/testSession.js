import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ApiError } from './errorHandler.js';

const TTL = 60 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest();
const cookieName = '__Host-navi-test';

// Sessions authorize synthetic testing, never real patient or bank-data intake.
export function createTestSessions(config, repository, { providerMode = config.aiMode, now = Date.now } = {}) {
  const sessions = new Map(); const owners = new Map();
  const requestSessions = new WeakMap();
  const requestScope = new AsyncLocalStorage();
  const enabled = config.restrictedLive;
  function sweep() {
    for (const [id, session] of sessions) if (session.expiresAt <= now()) {
      for (const [journeyId, owner] of owners) if (owner === id) { repository.delete(journeyId); owners.delete(journeyId); }
      sessions.delete(id);
    }
    for (const session of sessions.values()) for (const [key, record] of session.intents) if (record.until <= now() && !record.pending) session.intents.delete(key);
  }
  if (enabled) setInterval(sweep, 60000).unref();
  function current(req) {
    sweep();
    if (sessions.has(requestSessions.get(req))) return requestSessions.get(req);
    const matches = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`));
    if (matches.length !== 1) return null;
    const id = matches[0].slice(cookieName.length + 1);
    return sessions.has(id) ? id : null;
  }
  function issue(req, res, operator) {
    sweep();
    if (sessions.size >= 20) throw new ApiError('TEST_SESSION_CAPACITY', '目前使用人數較多，請稍後再試。', 429, true);
    const id = randomBytes(32).toString('hex');
    sessions.set(id, { expiresAt: now() + TTL, intents: new Map(), operator, aiRequests: 0 });
    requestSessions.set(req, id);
    res.cookie(cookieName, id, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: TTL });
  }
  function requireSession(req) {
    if (!enabled) return;
    if (!current(req)) throw new ApiError('TEST_SESSION_REQUIRED', '此原型目前僅開放經授權的合成資料測試；請使用示範模式。', 403, false);
    if (!['GET', 'HEAD'].includes(req.method) && !config.origins.includes(req.headers.origin)) throw new ApiError('ORIGIN_NOT_ALLOWED', '請從核准的 NAVI 網頁操作。', 403, false);
  }
  function documentUpload(req) {
    const session = sessions.get(current(req));
    const allowed = enabled && Boolean(session) && (config.publicSynthetic || session.operator === true);
    return { builtInSynthetic: allowed, userProvidedSynthetic: allowed, realPersonalDocuments: false };
  }
  return {
    // Charge provider attempts, not HTTP actions such as receipt-backed creation or invalid uploads.
    bindProvider(provider) {
      if (!enabled) return provider;
      const bound = { ...provider };
      for (const method of ['understandIntent', 'understandTasks', 'analyzeDocument', 'answerKnowledge', 'summarizeHandoff']) {
        if (!provider[method]) continue;
        bound[method] = (...args) => {
          const id = requestScope.getStore();
          const session = sessions.get(id);
          if (!session || session.expiresAt <= now()) throw new ApiError('TEST_SESSION_REQUIRED', '工作階段已失效，請重新開始。', 403, false);
          if (session.aiRequests >= (config.sessionRequestLimit ?? 6)) throw new ApiError('AI_SESSION_LIMIT_REACHED', '這個工作階段的 AI 操作次數已用完，請使用示範模式或由工作人員協助。', 429, false);
          session.aiRequests++;
          return provider[method](...args);
        };
      }
      return bound;
    },
    documentUpload,
    activate(req, res) {
      if (!enabled || config.sessionToken.length < 32) throw new ApiError('AI_UNAVAILABLE', '目前未開放合成資料測試。', 503, false);
      const body = req.body;
      if (!config.origins.includes(req.headers.origin) || !body || Object.keys(body).sort().join(',') !== 'syntheticOnly,token' || body.syntheticOnly !== true || typeof body.token !== 'string' || !timingSafeEqual(hash(body.token), hash(config.sessionToken))) throw new ApiError('TEST_SESSION_DENIED', '無法啟用測試，請確認授權與合成資料聲明。', 403, false);
      issue(req, res, true);
      res.set('Cache-Control', 'no-store').status(201).json({ syntheticOnly: true, documentUpload: documentUpload(req), expiresInSeconds: TTL / 1000, disclosure: '僅限合成資料。資料會送至 Google Gemini；免費服務資料可能用於改善產品。不可上傳真實醫療、銀行或個人資料。', documentRetention: '上傳檔案僅於記憶體中分析，不寫入磁碟；結構化測試案件最長保留一小時，重啟即清除。' });
    },
    guard(req, res, next) {
      try {
        if (enabled && config.publicSynthetic && !current(req)) {
          if (!config.origins.includes(req.headers.origin)) throw new ApiError('ORIGIN_NOT_ALLOWED', '請從核准的 NAVI 網頁操作。', 403, false);
          issue(req, res, false);
        }
        requireSession(req);
        requestScope.run(current(req), next);
      } catch (error) { next(error); }
    },
    authorizeDocument(req) {
      requireSession(req);
    },
    own(req, id) { if (enabled) owners.set(id, current(req)); },
    authorize(req, id) {
      requireSession(req);
      if (enabled && owners.get(id) !== current(req)) throw new ApiError('JOURNEY_NOT_FOUND', '找不到這份服務旅程，請在原測試工作階段重新開始。', 404, false);
    },
    remember(req, message, data, taskId = null) {
      if (!enabled) return;
      const session = sessions.get(current(req));
      if (session) {
        const key = hash(message).toString('hex');
        // Re-analysis must not erase an in-flight creation.
        if (session.intents.get(key)?.pending) return;
        if (session.intents.size >= 32 && !session.intents.has(key)) session.intents.delete(session.intents.keys().next().value);
        session.intents.set(key, { data: structuredClone(data), taskId, providerMode, operation: 'create_journey', until: now() + 300000 });
      }
    },
    async createJourney(req, input, create) {
      if (!enabled) return create();
      requireSession(req);
      const session = sessions.get(current(req)); const key = hash(input.message).toString('hex');
      let record = session.intents.get(key);
      if (!record && input.intentResult) throw new ApiError('INTENT_RECEIPT_REQUIRED', '需求分析已失效或內容不符，請重新分析後再選擇任務。', 409, false);
      if (!record) {
        record = { providerMode, operation: 'create_journey', until: now() + 300000 };
        session.intents.set(key, record);
      }
      if (record.until <= now() || record.providerMode !== providerMode || record.operation !== 'create_journey') throw new ApiError('INTENT_RECEIPT_REQUIRED', '需求分析已失效，請重新分析後再選擇任務。', 409, false);
      if (record.journeyId) {
        const journey = repository.get(record.journeyId);
        if (!journey) throw new ApiError('JOURNEY_NOT_FOUND', '這份服務旅程已失效，請重新分析。', 404, false);
        return journey;
      }
      if (record.pending) return record.pending;
      record.pending = Promise.resolve().then(() => create(record.data ? structuredClone(record.data) : undefined));
      try { const journey = await record.pending; record.journeyId = journey.id; return journey; }
      finally { delete record.pending; }
    },
  };
}
