import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errorHandler.js';

const TTL = 60 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest();
const cookieName = '__Host-navi-test';

// Sessions authorize synthetic testing, never real patient or bank-data intake.
export function createTestSessions(config, repository) {
  const sessions = new Map(); const owners = new Map();
  const requestSessions = new WeakMap();
  const enabled = config.restrictedLive;
  function sweep() {
    for (const [id, session] of sessions) if (session.expiresAt <= Date.now()) {
      for (const [journeyId, owner] of owners) if (owner === id) { repository.delete(journeyId); owners.delete(journeyId); }
      sessions.delete(id);
    }
    for (const session of sessions.values()) for (const [key, record] of session.intents) if (record.until <= Date.now()) session.intents.delete(key);
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
    sessions.set(id, { expiresAt: Date.now() + TTL, intents: new Map(), operator, aiRequests: 0 });
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
        if (enabled) {
          const session = sessions.get(current(req));
          if (session.aiRequests >= (config.sessionRequestLimit ?? 6)) throw new ApiError('AI_SESSION_LIMIT_REACHED', '這個工作階段的 AI 操作次數已用完，請使用示範模式或由工作人員協助。', 429, false);
          session.aiRequests++;
        }
        next();
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
    remember(req, message, data) {
      if (!enabled) return;
      const session = sessions.get(current(req));
      if (session) { if (session.intents.size >= 10) session.intents.clear(); session.intents.set(hash(message).toString('hex'), { data: structuredClone(data), until: Date.now() + 300000 }); }
    },
    intent(req, message) {
      if (!enabled) return undefined;
      const record = sessions.get(current(req))?.intents.get(hash(message).toString('hex'));
      return record?.until > Date.now() ? structuredClone(record.data) : undefined;
    },
  };
}
