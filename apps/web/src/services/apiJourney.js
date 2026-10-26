import { z } from 'zod';
import { ServiceJourneySchema } from '../../../../shared/journey.js';
import { HandoffConfirmationSchema, HandoffPreviewSchema, JourneyExplanationSchema, NavigationPlanResponseSchema } from '../../../../shared/competition.js';
import { planNavigation } from '../../../../shared/knowledge/navigationPlan.js';
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
// Privacy: the browser keeps only the journey id and display flags. The description and document
// fields stay on the server and are read back after a reload.
const Stored = z.object({
  v: z.literal(2), journeyId: z.string().uuid(), source: z.enum(['gemini', 'demo_fallback']), handoffRequested: z.boolean(),
}).strict();
// The server does not retain the description (it keeps a neutral note instead). Until a reload the
// user sees their own masked words, held in memory only; afterwards the server's note.
const storyOf = journey => journey.conversation.find(entry => entry.role === 'user')?.message ?? '';
const UploadResponse = z.object({ journey: ServiceJourneySchema }).passthrough();

export function createApiJourneyService({
  understand, storage, storageKey = 'navi.journey', fetchImpl = (...args) => fetch(...args),
  baseUrl = import.meta.env?.VITE_API_BASE_URL || '', timeoutMs = 15000, documentTimeoutMs = 45000,
}) {
  let state = null;
  let pending = null; // stored journey reference waiting to be read back from the server
  // X-NAVI-AI-Mode of the server. A 'demo' server answers every upload with fixed sample fields
  // whatever the file holds, so formal mode never sends the user's own file there.
  let aiMode = null;
  const api = path => `${baseUrl.replace(/\/$/, '')}/api${path}`;

  function save() {
    try {
      if (state) storage?.setItem(storageKey, JSON.stringify({ v: 2, journeyId: state.journey.id, source: state.source, handoffRequested: state.handoffRequested }));
      else storage?.removeItem(storageKey);
    } catch { /* Storage can be unavailable; the journey id then lives in memory only. */ }
  }
  const snapshot = () => (state ? { journey: state.journey, context: { kind: kindOf(state.journey.serviceType), story: state.story ?? storyOf(state.journey), source: state.source, handoffRequested: state.handoffRequested } } : null);
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
    aiMode = response.headers?.get?.('X-NAVI-AI-Mode') ?? aiMode;
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
    capabilities: { manualEntry: false, manualInformation: true, samples: 'ai' },
    /** Nothing to show synchronously: the journey itself is only on the server (see resume). */
    restore() {
      state = null;
      try {
        const parsed = Stored.safeParse(JSON.parse(storage?.getItem(storageKey) ?? 'null'));
        pending = parsed.success ? parsed.data : null;
        if (!parsed.success) storage?.removeItem(storageKey); // older formats held the raw description
      } catch { pending = null; }
      return null;
    },
    hasStoredJourney: () => Boolean(pending),
    /** Read a stored journey back from the server (it may have expired: 1 hour TTL, cleared on restart). */
    async resume({ signal } = {}) {
      if (!pending) return null;
      const { journeyId, source, handoffRequested } = pending;
      try {
        const journey = await request(`/journeys/${journeyId}`, { signal });
        pending = null;
        state = { journey, source, handoffRequested };
        save();
        return snapshot();
      } catch (error) {
        if (error.code === 'JOURNEY_NOT_FOUND') { pending = null; save(); }
        throw error;
      }
    },
    async analyze(message, { signal, openJourney = () => true } = {}) {
      const understanding = await understand(message, { signal });
      const kind = kindOf(understanding.data.serviceType);
      // Only a 住院醫療理賠 service request has a server-owned journey. Information questions
      // (intent knowledge_query) are answered from official data; the server refuses them with 409.
      const serviceRequest = understanding.data.intent === 'service_request';
      if (kind !== 'hospital' || !serviceRequest || !opensJourney(understanding, kind) || !openJourney(kind)) return { understanding, kind, snapshot: null };
      const journey = await request('/journeys', { method: 'POST', json: { message: message.trim(), intentResult: understanding.data }, signal });
      pending = null; // a new journey replaces any stored one that was not read back yet
      if (journey.serviceType !== 'hospitalization_claim') return { understanding, kind: kindOf(journey.serviceType), snapshot: null };
      state = { journey, story: redactIdentifiers(message.trim()), source: understanding.meta.source, handoffRequested: false };
      save();
      return { understanding, kind, snapshot: snapshot() };
    },
    async uploadDocument(type, { file = null, sample = false } = {}, { signal } = {}) {
      const { journey } = requireState();
      const own = Boolean(file) && !sample;
      if (own && aiMode === 'demo') throw new JourneyApiError('DOCUMENT_RECOGNITION_UNAVAILABLE', RECOGNITION_UNAVAILABLE_MESSAGE);
      const form = new FormData();
      form.append('file', own ? file : samplePdfFile(type));
      form.append('documentType', type);
      const result = await request(`/journeys/${journey.id}/documents`, { method: 'POST', body: form, signal, timeout: documentTimeoutMs, schema: UploadResponse });
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
    reset() { state = null; save(); },
    setFailNextDocument() { /* Demo-only control; the server decides recognition outcomes. */ },
  };
}
