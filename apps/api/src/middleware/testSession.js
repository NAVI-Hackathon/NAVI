import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errorHandler.js';

const TTL = 60 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest();
const cookieName = '__Host-navi-test';

// Operator-only synthetic staging; this is not patient authentication or public medical intake.
export function createTestSessions(config, repository) {
  const sessions = new Map(); const owners = new Map();
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
    const matches = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`));
    if (matches.length !== 1) return null;
    const id = matches[0].slice(cookieName.length + 1);
    return sessions.has(id) ? id : null;
  }
  function requireSession(req) {
    if (!enabled) return;
    if (!current(req)) throw new ApiError('TEST_SESSION_REQUIRED', '此原型目前僅開放經授權的合成資料測試；請使用示範模式。', 403, false);
    if (!['GET', 'HEAD'].includes(req.method) && !config.origins.includes(req.headers.origin)) throw new ApiError('ORIGIN_NOT_ALLOWED', '請從核准的 NAVI 網頁操作。', 403, false);
  }
  return {
    activate(req, res) {
      if (!enabled || config.sessionToken.length < 32) throw new ApiError('AI_UNAVAILABLE', '目前未開放合成資料測試。', 503, false);
      const body = req.body;
      if (!config.origins.includes(req.headers.origin) || !body || Object.keys(body).sort().join(',') !== 'syntheticOnly,token' || body.syntheticOnly !== true || typeof body.token !== 'string' || !timingSafeEqual(hash(body.token), hash(config.sessionToken))) throw new ApiError('TEST_SESSION_DENIED', '無法啟用測試，請確認授權與合成資料聲明。', 403, false);
      sweep();
      if (sessions.size >= 20) throw new ApiError('TEST_SESSION_CAPACITY', '測試工作階段已達上限，請稍後再試。', 429, true);
      const id = randomBytes(32).toString('hex');
      sessions.set(id, { expiresAt: Date.now() + TTL, intents: new Map() });
      res.cookie(cookieName, id, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: TTL });
      res.set('Cache-Control', 'no-store').status(201).json({ syntheticOnly: true, expiresInSeconds: TTL / 1000, disclosure: '僅限合成資料。資料會送至 Google Gemini；免費服務資料可能用於改善產品。不可上傳真實醫療、銀行或個人資料。', documentRetention: '上傳檔案僅於記憶體中分析，不寫入磁碟；結構化測試案件最長保留一小時，重啟即清除。' });
    },
    guard(req, res, next) { try { requireSession(req); next(); } catch (error) { next(error); } },
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
