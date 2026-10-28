import { z } from 'zod';
import { ServiceJourneySchema } from '../../../../shared/journey.js';
import { HandoffConfirmationSchema, HandoffPreviewSchema, JourneyExplanationSchema, NavigationPlanResponseSchema } from '../../../../shared/competition.js';
import { planNavigation } from '../../../../shared/knowledge/navigationPlan.js';
import { CorrectJourneyIntentResponseSchema, TaskUnderstandingSchema } from '../../../../shared/serviceTasks.js';
import { DEFAULT_CONFIDENCE_THRESHOLD, UnderstandingSchema } from '../../../../shared/intelligence.js';
import { opensJourney } from './naviService.js';
import { samplePdfFile } from '../mocks/sampleDocuments.js';
import { redactIdentifiers } from '../domain/privacy.js';

// Formal mode: the journey is owned by apps/api (readiness, stage, next action, claim context).
// This client only sends the user's actions and renders what the server returns.

export class JourneyApiError extends Error {
  constructor(code, message, status = 0) { super(message || code); this.code = code; this.status = status; }
}
export const JOURNEY_EXPIRED_MESSAGE = '這份服務旅程已失效或不存在，請重新開始。';
export const RECOGNITION_UNAVAILABLE_MESSAGE = '目前線上服務尚未啟用文件辨識，NAVI 無法讀取你上傳的文件。你可以先提供資訊（尚未驗證），或洽客服專線由專人協助。';

const kindOf = serviceType => (serviceType === 'hospitalization_claim' ? 'hospital' : serviceType);
// Privacy: the browser keeps only journey ids and display flags. The description and document
// fields stay on the server and are read back after a reload.
const JourneyRef = z.object({ journeyId: z.string().uuid(), source: z.enum(['gemini', 'demo_fallback']), handoffRequested: z.boolean() }).strict();
const StoredV2 = JourneyRef.extend({ v: z.literal(2) }).strict();
// v3: several journeys of this browser (most recent first) and the one shown now.
const Stored = z.object({ v: z.literal(3), current: z.string().uuid().nullable(), journeys: z.array(JourneyRef).max(5) }).strict();
const MAX_JOURNEYS = 5;
// The server does not retain the description (it keeps a neutral note instead). Until a reload the
// user sees their own masked words, held in memory only; afterwards the server's note.
const storyOf = journey => journey.conversation.find(entry => entry.role === 'user')?.message ?? '';
const UploadResponse = z.object({ journey: ServiceJourneySchema }).passthrough();

/**
 * One task of /intelligence/tasks as the single-intent understanding the rest of the client uses, so a chosen
 * task opens its journey without a second AI call. Null when it does not validate (then understand normally).
 */
export function understandingOfTask(split, task) {
  const parsed = UnderstandingSchema.safeParse({
    success: true, data: task.data,
    meta: { source: split.provider === 'live' ? 'gemini' : 'demo_fallback', outcome: task.outcome, confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD },
  });
  return parsed.success ? parsed.data : null;
}

/** What a task list shows for one journey: the server's own fields, plus the hospital to tell two claims apart. */
export function journeySummary(journey) {
  const hospital = journey.claimContext?.hospital;
  return {
    title: journey.title, serviceType: journey.serviceType, supported: journey.supported, currentStage: journey.currentStage,
    readiness: journey.readiness, createdAt: journey.createdAt, updatedAt: journey.updatedAt, detail: hospital?.matchedName ?? hospital?.mentioned ?? null,
  };
}

/**
 * fetch-like POST that reports how much of the body was actually sent (XMLHttpRequest upload events).
 * onProgress({ phase: 'uploading', loaded, total }) while sending, then { phase: 'analyzing' } once the
 * server has the whole file and is reading it. Browser only; elsewhere uploads go through fetch.
 */
export function xhrUpload(url, { method = 'POST', body, signal, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.upload.onprogress = event => onProgress?.({ phase: 'uploading', loaded: event.loaded, total: event.lengthComputable ? event.total : null });
    xhr.upload.onload = () => onProgress?.({ phase: 'analyzing' });
    xhr.onload = () => resolve({
      ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status,
      headers: { get: name => xhr.getResponseHeader(name) },
      json: async () => JSON.parse(xhr.responseText),
    });
    xhr.onerror = () => reject(new TypeError('Network request failed'));
    xhr.onabort = () => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    if (signal?.aborted) { xhr.abort(); return; }
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

export function createApiJourneyService({
  understand, storage, storageKey = 'navi.journey', fetchImpl = (...args) => fetch(...args),
  baseUrl = import.meta.env?.VITE_API_BASE_URL || '', timeoutMs = 15000, documentTimeoutMs = 45000,
  uploadImpl = typeof XMLHttpRequest === 'undefined' ? null : xhrUpload,
}) {
  let state = null;
  let pending = null; // stored journey reference waiting to be read back from the server
  let refs = []; // journeys of this browser, most recent first: ids and display flags only
  // The server's latest answer for each journey seen in this tab (memory only), so listing the tasks does
  // not GET every journey again on each change (the API is rate limited). Switching always reads afresh.
  const seen = new Map();
  const remember = journey => { seen.set(journey.id, journey); return journey; };
  // X-NAVI-AI-Mode of the server. A 'demo' server answers every upload with fixed sample fields
  // whatever the file holds, so formal mode never sends the user's own file there.
  let aiMode = null;
  const modeListeners = new Set();
  const setAiMode = value => {
    if (!value || value === aiMode) return;
    aiMode = value;
    for (const listener of modeListeners) listener();
  };
  const api = path => `${baseUrl.replace(/\/$/, '')}/api${path}`;

  const drop = id => { refs = refs.filter(ref => ref.journeyId !== id); seen.delete(id); };
  function save() {
    if (state) refs = [{ journeyId: state.journey.id, source: state.source, handoffRequested: state.handoffRequested }, ...refs.filter(ref => ref.journeyId !== state.journey.id)].slice(0, MAX_JOURNEYS);
    try {
      if (refs.length) storage?.setItem(storageKey, JSON.stringify({ v: 3, current: state?.journey.id ?? pending?.journeyId ?? null, journeys: refs }));
      else storage?.removeItem(storageKey);
    } catch { /* Storage can be unavailable; the journey ids then live in memory only. */ }
  }
  /** GET one journey; a journey the server no longer has leaves this browser's list. */
  async function read(id, { signal } = {}) {
    try { return remember(await request(`/journeys/${id}`, { signal })); }
    catch (error) {
      if (error.code === 'JOURNEY_NOT_FOUND') { drop(id); save(); }
      throw error;
    }
  }
  const snapshot = () => (state ? { journey: state.journey, context: { kind: kindOf(state.journey.serviceType), story: state.story ?? storyOf(state.journey), source: state.source, handoffRequested: state.handoffRequested } } : null);
  function commit(journey) { state = { ...state, journey: remember(journey) }; save(); return snapshot(); }
  function requireState() { if (!state) throw new JourneyApiError('JOURNEY_NOT_FOUND', JOURNEY_EXPIRED_MESSAGE, 404); return state; }

  async function request(path, { method = 'GET', body, json, signal, timeout = timeoutMs, schema = ServiceJourneySchema, onProgress } = {}) {
    const deadline = AbortSignal.timeout(timeout);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let response;
    try {
      // A file upload with a progress listener goes through XHR (real bytes sent); everything else through fetch.
      if (onProgress && body && uploadImpl) response = await uploadImpl(api(path), { method, body, signal: combined, onProgress });
      else {
        onProgress?.({ phase: 'sending' }); // no byte count available: the UI says 上傳並辨識中 without a percentage
        response = await fetchImpl(api(path), {
          method, signal: combined,
          ...(json ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) } : body ? { body } : {}),
        });
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw new JourneyApiError(deadline.aborted ? 'AI_TIMEOUT' : 'NETWORK_ERROR', deadline.aborted ? '處理時間較長，請再試一次。' : '目前無法連線到服務，請確認網路後再試一次。');
    }
    setAiMode(response.headers?.get?.('X-NAVI-AI-Mode'));
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
    // Manual information is accepted but never verified: it is stored as「待確認」 next to the
    // evidence, adds no readiness and cannot unlock review (POST /manual-document-information).
    // Formal mode is real use: its sample is the synthetic PDF, sent to the server and read by the
    // AI like any upload (Live accepts only approved synthetic files). /demo samples never leave the browser.
    capabilities: { manualEntry: false, manualInformation: true, samples: 'ai', tasks: true, correction: true, journeys: true, uploadProgress: true },
    documentTimeoutMs,
    /**
     * What answers on the server: 'live' (Gemini), 'demo' (fixed synthetic results) or 'unavailable'.
     * Learned from every response (X-NAVI-AI-Mode) and from GET /ai/status; null until the first answer.
     * The page labels results by it, so a demo server is never presented as AI analysis.
     */
    get aiMode() { return aiMode; },
    subscribeAiMode(listener) { modeListeners.add(listener); return () => modeListeners.delete(listener); },
    async checkAiMode({ signal } = {}) {
      try {
        const response = await fetchImpl(api('/ai/status'), { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
        const body = await response.json().catch(() => null);
        setAiMode(response.headers?.get?.('X-NAVI-AI-Mode') ?? (['live', 'demo', 'unavailable'].includes(body?.mode) ? body.mode : null));
      } catch { /* unknown until the next answer; nothing is claimed meanwhile */ }
      return aiMode;
    },
    /** Nothing to show synchronously: the journeys themselves are only on the server (see resume). */
    restore() {
      state = null;
      pending = null;
      refs = [];
      try {
        const raw = JSON.parse(storage?.getItem(storageKey) ?? 'null');
        const v3 = Stored.safeParse(raw);
        const v2 = v3.success ? null : StoredV2.safeParse(raw);
        if (v3.success) refs = v3.data.journeys;
        else if (v2.success) refs = [{ journeyId: v2.data.journeyId, source: v2.data.source, handoffRequested: v2.data.handoffRequested }];
        else storage?.removeItem(storageKey); // older formats held the raw description
        const current = v3.success ? v3.data.current : v2?.success ? v2.data.journeyId : null;
        pending = refs.find(ref => ref.journeyId === current) ?? null;
      } catch { pending = null; refs = []; }
      return null;
    },
    hasStoredJourney: () => Boolean(pending),
    /** Read a stored journey back from the server (it may have expired: 1 hour TTL, cleared on restart). */
    async resume({ signal } = {}) {
      if (!pending) return null;
      const { journeyId, source, handoffRequested } = pending;
      try {
        const journey = await read(journeyId, { signal });
        pending = null;
        state = { journey, source, handoffRequested };
        save();
        return snapshot();
      } catch (error) {
        if (error.code === 'JOURNEY_NOT_FOUND') { pending = null; save(); }
        throw error;
      }
    },
    /**
     * This browser's journeys as the server has them now (GET each; no AI call). A journey the server no
     * longer has is removed from the list; one that could not be read (network) stays, marked unavailable.
     */
    async listJourneys({ signal } = {}) {
      const ids = refs.map(ref => ref.journeyId);
      const known = id => (id === state?.journey.id ? state.journey : seen.get(id));
      const results = await Promise.allSettled(ids.map(id => (known(id) ? Promise.resolve(known(id)) : read(id, { signal }))));
      if (signal?.aborted) throw signal.reason;
      return ids.flatMap((id, i) => {
        const result = results[i];
        if (result.status === 'rejected' && result.reason?.code === 'JOURNEY_NOT_FOUND') return [];
        const journey = result.status === 'fulfilled' ? result.value : null;
        return [{
          id, current: id === state?.journey.id, unavailable: !journey,
          ...(journey && journeySummary(journey)),
        }];
      });
    },
    /** Show another journey of this browser: its state is read from the server, not from a local copy. */
    async switchJourney(id, { signal } = {}) {
      const ref = refs.find(item => item.journeyId === id);
      if (!ref) throw new JourneyApiError('JOURNEY_NOT_FOUND', JOURNEY_EXPIRED_MESSAGE, 404);
      const journey = await read(id, { signal });
      state = { journey, source: ref.source, handoffRequested: ref.handoffRequested };
      pending = null;
      save();
      return snapshot();
    },
    /** The shown journey expired: drop only it. Returns how many other journeys this browser still has. */
    forgetCurrent() {
      if (state) drop(state.journey.id);
      if (pending) drop(pending.journeyId);
      state = null;
      pending = null;
      save();
      return refs.length;
    },
    /**
     * The user removes one journey from this browser (資料與隱私 / 任務列). Only the id is forgotten here;
     * the server copy expires on its own (no journey DELETE endpoint yet). Returns how many remain.
     */
    forgetJourney(id) {
      if (state?.journey.id === id || pending?.journeyId === id) return this.forgetCurrent();
      drop(id);
      save();
      return refs.length;
    },
    /**
     * Several independent requests in one message (POST /intelligence/tasks: one AI call, at most four tasks).
     * Null when the server has no such endpoint (older release): the caller then understands it as one request.
     */
    async understandTasks(message, { signal } = {}) {
      try {
        return await request('/intelligence/tasks', { method: 'POST', json: { message: message.trim() }, signal, schema: TaskUnderstandingSchema });
      } catch (error) {
        if (error?.status === 404 && error.code !== 'JOURNEY_NOT_FOUND') return null;
        throw error;
      }
    },
    /** `understanding`: already known (a chosen task) — then the message is not sent to the AI again. */
    async analyze(message, { signal, openJourney = () => true, understanding: known = null } = {}) {
      const understanding = known ?? await understand(message, { signal });
      const kind = kindOf(understanding.data.serviceType);
      // Only a 住院醫療理賠 service request has a server-owned journey. Information questions
      // (intent knowledge_query) are answered from official data; the server refuses them with 409.
      const serviceRequest = understanding.data.intent === 'service_request';
      if (kind !== 'hospital' || !serviceRequest || !opensJourney(understanding, kind) || !openJourney(kind)) return { understanding, kind, snapshot: null };
      const journey = await request('/journeys', { method: 'POST', json: { message: message.trim(), intentResult: understanding.data }, signal });
      pending = null; // the new journey is the one shown; earlier ones stay in the list
      if (journey.serviceType !== 'hospitalization_claim') return { understanding, kind: kindOf(journey.serviceType), snapshot: null };
      state = { journey: remember(journey), story: redactIdentifiers(message.trim()), source: understanding.meta.source, handoffRequested: false };
      save();
      return { understanding, kind, snapshot: snapshot() };
    },
    async uploadDocument(type, { file = null, sample = false } = {}, { signal, onProgress } = {}) {
      const { journey } = requireState();
      const own = Boolean(file) && !sample;
      if (own && aiMode === 'demo') throw new JourneyApiError('DOCUMENT_RECOGNITION_UNAVAILABLE', RECOGNITION_UNAVAILABLE_MESSAGE);
      const form = new FormData();
      form.append('file', own ? file : samplePdfFile(type));
      form.append('documentType', type);
      const result = await request(`/journeys/${journey.id}/documents`, { method: 'POST', body: form, signal, timeout: documentTimeoutMs, schema: UploadResponse, onProgress });
      const added = result.journey.documents.find(d => d.documentType === type);
      // Fixture fields are never shown as the user's document (e.g. a proxy that drops the mode header).
      if (own && added?.isMock) {
        commit(await request(`/journeys/${journey.id}/documents/${added.id}`, { method: 'DELETE' }));
        throw new JourneyApiError('DOCUMENT_RECOGNITION_UNAVAILABLE', RECOGNITION_UNAVAILABLE_MESSAGE);
      }
      return commit(result.journey);
    },
    async submitManual(type, fields) {
      const { journey } = requireState();
      const result = await request(`/journeys/${journey.id}/manual-document-information`, { method: 'POST', json: { documentType: type, fields }, schema: UploadResponse });
      return commit(result.journey);
    },
    async removeManual(type) {
      const { journey } = requireState();
      return commit(await request(`/journeys/${journey.id}/manual-document-information/${type}`, { method: 'DELETE' }));
    },
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
    /**
     * Step-by-step guide from a knowledge source (POST /navigation/plans). The plan is built from the same
     * shared snapshot either way, so if the API is unreachable the local plan is used instead.
     */
    async navigationPlan(sourceId, { signal } = {}) {
      try {
        return await request('/navigation/plans', { method: 'POST', json: { sourceId }, signal, schema: NavigationPlanResponseSchema });
      } catch (error) {
        if (signal?.aborted || error?.status) throw error;
        return planNavigation({ sourceId });
      }
    },
    /** Why each requirement is (not) counted: GET /journeys/:id/explanation (reason codes, earned points). */
    async explain({ signal } = {}) {
      const { journey } = requireState();
      return request(`/journeys/${journey.id}/explanation`, { signal, schema: JourneyExplanationSchema });
    },
    /** Consent-based handoff: a redacted preview bound to this journey version, then the user's confirmation. Nothing is sent. */
    async handoffPreview({ signal } = {}) {
      const { journey } = requireState();
      return request(`/journeys/${journey.id}/handoff/preview`, { method: 'POST', json: {}, signal, schema: HandoffPreviewSchema });
    },
    async confirmHandoff(previewId, { signal } = {}) {
      const { journey } = requireState();
      return request(`/journeys/${journey.id}/handoff/confirm`, { method: 'POST', json: { previewId, confirmed: true }, signal, schema: HandoffConfirmationSchema });
    },
    requestHandoff() { requireState(); state = { ...state, handoffRequested: true }; save(); return snapshot(); },
    /** Read the journey again (after JOURNEY_STALE: another change won; nothing is retried automatically). */
    async refresh({ signal } = {}) {
      const { journey } = requireState();
      return commit(await request(`/journeys/${journey.id}`, { signal }));
    },
    /**
     * The user says NAVI understood the wrong service (POST /journeys/:id/intent-correction). The server
     * re-reads the need; kept documents need confirming again and earn nothing until then.
     */
    async correctIntent(message, { signal } = {}) {
      const { journey } = requireState();
      const result = await request(`/journeys/${journey.id}/intent-correction`, { method: 'POST', json: { message: message.trim() }, signal, timeout: timeoutMs, schema: CorrectJourneyIntentResponseSchema });
      state = { ...state, story: redactIdentifiers(message.trim()) };
      return { snapshot: commit(result.journey), previousServiceType: result.previousServiceType };
    },
    /** 重新開始: this browser forgets every journey (the server copies expire on their own). */
    reset() { state = null; pending = null; refs = []; seen.clear(); save(); },
    setFailNextDocument() { /* Demo-only control; the server decides recognition outcomes. */ },
  };
}
