import {
  createSession, toSnapshot, journeyKind, supportsDocuments, applySampleDocument, applyManualDocument,
  removeDocument, confirmSession, requestHandoff, serializeSession, restoreSession,
} from './journeyEngine.js';
import { localHandoffSummary } from '../domain/preflight.js';

export class DocumentRecognitionError extends Error {
  constructor() { super('DOCUMENT_RECOGNITION_FAILED'); this.code = 'DOCUMENT_RECOGNITION_FAILED'; }
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

/** Which outcomes open a workspace. Clarification and services outside the prototype stay on the landing page. */
export function opensJourney(understanding, kind) {
  const { outcome } = understanding.meta;
  if (outcome === 'clarification') return false;
  if (outcome === 'human_review') return kind !== 'unknown';
  return kind !== 'unknown';
}

/**
 * The single service the UI talks to. `understand` is the adapter-specific intent source;
 * journeys, documents and readiness come from the local engine.
 */
export function createJourneyService({ mode, understand, storage, storageKey, documentDelayMs = 1000 }) {
  let session = null;
  let failNextDocument = false;
  const provider = mode === 'live' ? 'live' : 'demo';

  function save() {
    try { if (session) storage?.setItem(storageKey, serializeSession(session)); else storage?.removeItem(storageKey); }
    catch { /* Storage can be unavailable (private mode); the journey keeps working in memory. */ }
  }
  function commit(next) { session = next; save(); return toSnapshot(session); }
  function requireSession() { if (!session) throw new Error('No active journey.'); return session; }

  return {
    mode,
    // /demo computes the journey locally; manual entries there count as confirmed demo data.
    capabilities: { manualEntry: true, manualInformation: false },
    restore() {
      try { session = restoreSession(storage?.getItem(storageKey) ?? 'null'); } catch { session = null; }
      return session ? toSnapshot(session) : null;
    },
    /** `openJourney(kind)` lets the caller keep a recognised service on the landing page (e.g. to show official answers). */
    async analyze(message, { signal, openJourney = () => true } = {}) {
      const understanding = await understand(message, { signal });
      const candidate = createSession(message, understanding, provider);
      const kind = journeyKind(candidate);
      if (!opensJourney(understanding, kind) || !openJourney(kind)) return { understanding, kind, snapshot: null };
      return { understanding, kind, snapshot: commit(candidate) };
    },
    async uploadDocument(type, { file = null, sample = false } = {}, { signal } = {}) {
      const current = requireSession();
      if (!supportsDocuments(current)) throw new Error('This journey has no document workflow.');
      await wait(documentDelayMs, signal);
      if (failNextDocument) { failNextDocument = false; throw new DocumentRecognitionError(); }
      const meta = sample || !file ? { entryMethod: 'sample' } : { filename: file.name, mimeType: file.type, size: file.size, entryMethod: 'upload' };
      return commit(applySampleDocument(current, type, meta));
    },
    submitManual(type, fields) { return commit(applyManualDocument(requireSession(), type, fields)); },
    removeDocument(type) { return commit(removeDocument(requireSession(), type)); },
    confirm() { return commit(confirmSession(requireSession())); },
    // /demo has no server: the Preflight board uses the local mirror of the reason codes (explain → null),
    // and the handoff preview/confirmation are built locally in the same shape as the server's.
    async explain() { return null; },
    async handoffPreview() {
      requireSession();
      return { previewId: crypto.randomUUID?.() ?? String(Date.now()), status: 'awaiting_confirmation', summary: localHandoffSummary(toSnapshot(session).journey) };
    },
    async confirmHandoff(previewId) {
      return { previewId, status: 'confirmed', delivery: 'not_sent', confirmedAt: new Date().toISOString(), summary: localHandoffSummary(toSnapshot(requireSession()).journey) };
    },
    requestHandoff() { return commit(requestHandoff(requireSession())); },
    reset() { session = null; save(); },
    setFailNextDocument(value) { failNextDocument = Boolean(value); },
  };
}
