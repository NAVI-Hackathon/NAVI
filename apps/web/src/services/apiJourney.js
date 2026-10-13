import { z } from 'zod';
import { ServiceJourneySchema } from '../../../../shared/journey.js';
import { opensJourney } from './naviService.js';
import { samplePdfFile } from '../mocks/sampleDocuments.js';

// Formal mode: the journey is owned by apps/api (readiness, stage, next action, claim context).
// This client only sends the user's actions and renders what the server returns.

export class JourneyApiError extends Error {
  constructor(code, message, status = 0) { super(message || code); this.code = code; this.status = status; }
}
export const JOURNEY_EXPIRED_MESSAGE = '這份服務旅程已失效或不存在，請重新開始。';

const kindOf = serviceType => (serviceType === 'hospitalization_claim' ? 'hospital' : serviceType);
const Stored = z.object({
  v: z.literal(1), journey: ServiceJourneySchema, story: z.string(), source: z.enum(['gemini', 'demo_fallback']), handoffRequested: z.boolean(),
}).strict();
const UploadResponse = z.object({ journey: ServiceJourneySchema }).passthrough();

export function createApiJourneyService({
  understand, storage, storageKey = 'navi.journey', fetchImpl = (...args) => fetch(...args),
  baseUrl = import.meta.env?.VITE_API_BASE_URL || '', timeoutMs = 15000, documentTimeoutMs = 45000,
}) {
  let state = null;
  const api = path => `${baseUrl.replace(/\/$/, '')}/api${path}`;

  function save() {
    try { if (state) storage?.setItem(storageKey, JSON.stringify({ v: 1, ...state })); else storage?.removeItem(storageKey); }
    catch { /* Storage can be unavailable; the journey id then lives in memory only. */ }
  }
  const snapshot = () => (state ? { journey: state.journey, context: { kind: kindOf(state.journey.serviceType), story: state.story, source: state.source, handoffRequested: state.handoffRequested } } : null);
  function commit(journey) { state = { ...state, journey }; save(); return snapshot(); }
  function requireState() { if (!state) throw new JourneyApiError('JOURNEY_NOT_FOUND', JOURNEY_EXPIRED_MESSAGE, 404); return state; }

  async function request(path, { method = 'GET', body, json, signal, timeout = timeoutMs, schema = ServiceJourneySchema } = {}) {
    const deadline = AbortSignal.timeout(timeout);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let response;
    try {
      response = await fetchImpl(api(path), {
        method, signal: combined,
        ...(json ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) } : body ? { body } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw new JourneyApiError(deadline.aborted ? 'AI_TIMEOUT' : 'NETWORK_ERROR', deadline.aborted ? '處理時間較長，請再試一次。' : '目前無法連線到服務，請確認網路後再試一次。');
    }
    let result = null;
    try { result = await response.json(); } catch { /* handled below */ }
    if (!response.ok) {
      const code = typeof result?.error?.code === 'string' ? result.error.code : response.status >= 500 ? 'API_UNAVAILABLE' : 'API_ERROR';
      const message = code === 'JOURNEY_NOT_FOUND' ? JOURNEY_EXPIRED_MESSAGE : typeof result?.error?.message === 'string' ? result.error.message : '目前暫時無法處理，請稍後再試。';
      throw new JourneyApiError(code, message, response.status);
    }
    const parsed = schema.safeParse(result);
    if (!parsed.success) throw new JourneyApiError('AI_RESPONSE_INVALID', '服務回應格式不完整，請稍後再試。');
    return parsed.data;
  }

  return {
    mode: 'live',
    // The server keeps documents; manual entry has no backend API yet, so it is off in formal mode.
    capabilities: { manualEntry: false },
    restore() {
      try {
        const parsed = Stored.safeParse(JSON.parse(storage?.getItem(storageKey) ?? 'null'));
        state = parsed.success ? { journey: parsed.data.journey, story: parsed.data.story, source: parsed.data.source, handoffRequested: parsed.data.handoffRequested } : null;
      } catch { state = null; }
      return snapshot();
    },
    /** Re-read the journey from the server (it may have expired: 1 hour TTL, cleared on restart). */
    async sync({ signal } = {}) {
      if (!state) return null;
      try { return commit(await request(`/journeys/${state.journey.id}`, { signal })); }
      catch (error) { if (error.code === 'JOURNEY_NOT_FOUND') { state = null; save(); } throw error; }
    },
    async analyze(message, { signal, openJourney = () => true } = {}) {
      const understanding = await understand(message, { signal });
      const kind = kindOf(understanding.data.serviceType);
      // Only a 住院醫療理賠 service request has a server-owned journey. Information questions
      // (intent knowledge_query) are answered from official data; the server refuses them with 409.
      const serviceRequest = understanding.data.intent === 'service_request';
      if (kind !== 'hospital' || !serviceRequest || !opensJourney(understanding, kind) || !openJourney(kind)) return { understanding, kind, snapshot: null };
      const journey = await request('/journeys', { method: 'POST', json: { message: message.trim(), intentResult: understanding.data }, signal });
      if (journey.serviceType !== 'hospitalization_claim') return { understanding, kind: kindOf(journey.serviceType), snapshot: null };
      state = { journey, story: message.trim(), source: understanding.meta.source, handoffRequested: false };
      save();
      return { understanding, kind, snapshot: snapshot() };
    },
    async uploadDocument(type, { file = null, sample = false } = {}, { signal } = {}) {
      const { journey } = requireState();
      const form = new FormData();
      form.append('file', sample || !file ? samplePdfFile(type) : file);
      form.append('documentType', type);
      const result = await request(`/journeys/${journey.id}/documents`, { method: 'POST', body: form, signal, timeout: documentTimeoutMs, schema: UploadResponse });
      return commit(result.journey);
    },
    submitManual() { throw new JourneyApiError('MANUAL_ENTRY_UNAVAILABLE', '正式模式目前不支援手動輸入文件內容，請上傳文件。'); },
    async removeDocument(type) {
      const { journey } = requireState();
      const document = journey.documents.find(d => d.documentType === type);
      if (!document) return snapshot();
      return commit(await request(`/journeys/${journey.id}/documents/${document.id}`, { method: 'DELETE' }));
    },
    async confirm() {
      const { journey } = requireState();
      return commit(await request(`/journeys/${journey.id}/review`, { method: 'POST', json: { confirmed: true } }));
    },
    requestHandoff() { requireState(); state = { ...state, handoffRequested: true }; save(); return snapshot(); },
    reset() { state = null; save(); },
    setFailNextDocument() { /* Demo-only control; the server decides recognition outcomes. */ },
  };
}
