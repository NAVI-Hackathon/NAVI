import {
  createSession, toSnapshot, journeyKind, supportsDocuments, applySampleDocument, applyManualDocument,
  removeDocument, confirmSession, requestHandoff, serializeSession, restoreSession,
} from './journeyEngine.js';
import { z } from 'zod';
import { localHandoffSummary } from '../domain/preflight.js';
import { redactIdentifiers } from '../domain/privacy.js';
import { planNavigation } from '../../../../shared/knowledge/navigationPlan.js';
import { TaskUnderstandingSchema } from '../../../../shared/serviceTasks.js';
import { journeySummary } from './apiJourney.js';

export class DocumentRecognitionError extends Error {
  constructor() { super('示範：這次沒有辨識出文件內容（模擬的辨識失敗）。'); this.code = 'DOCUMENT_RECOGNITION_FAILED'; }
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

// What this tab keeps (sessionStorage): up to MAX_JOURNEYS journeys, the one shown, and the requests from
// one message (the latest split, which of its tasks are answered). Nothing leaves the tab.
const MAX_JOURNEYS = 5;
const Stored = z.object({ v: z.literal(4), current: z.string().uuid().nullable(), sessions: z.array(z.unknown()).max(MAX_JOURNEYS) }).strict();
const StoredTasks = z.object({
  split: TaskUnderstandingSchema,
  open: z.array(z.string().regex(/^task-[1-4]$/)).max(4),
  answered: z.array(z.string().regex(/^task-[1-4]$/)).max(4),
}).strict();

/**
 * The single service the UI talks to. `understand` is the adapter-specific intent source;
 * journeys, documents and readiness come from the local engine. `splitTasks` (optional) lists the
 * independent requests in one message, in the server's TaskUnderstanding shape.
 */
export function createJourneyService({ mode, understand, splitTasks = null, storage, storageKey, documentDelayMs = 1000 }) {
  let sessions = []; // most recent first; `session` is the one shown
  let session = null;
  let failNextDocument = false;
  const provider = mode === 'live' ? 'live' : 'demo';
  const tasksKey = `${storageKey}.tasks`;

  function save() {
    try {
      if (sessions.length) storage?.setItem(storageKey, JSON.stringify({ v: 4, current: session?.journeyId ?? null, sessions: sessions.map(item => JSON.parse(serializeSession(item))) }));
      else storage?.removeItem(storageKey);
    } catch { /* Storage can be unavailable (private mode); the journeys keep working in memory. */ }
  }
  function commit(next) {
    session = next;
    sessions = [next, ...sessions.filter(item => item.journeyId !== next.journeyId)].slice(0, MAX_JOURNEYS);
    save();
    return toSnapshot(session);
  }
  function requireSession() { if (!session) throw new Error('No active journey.'); return session; }
  function find(id) {
    const found = sessions.find(item => item.journeyId === id);
    if (!found) { const error = new Error('這件事的示範資料已不在這個分頁。'); error.code = 'JOURNEY_NOT_FOUND'; throw error; }
    return found;
  }

  return {
    mode,
    // /demo computes the journeys locally; manual entries there count as confirmed demo data.
    capabilities: { manualEntry: true, manualInformation: false, samples: 'local', tasks: Boolean(splitTasks), journeys: true },
    restore() {
      sessions = [];
      session = null;
      try {
        const raw = storage?.getItem(storageKey) ?? 'null';
        const stored = Stored.safeParse(JSON.parse(raw));
        if (stored.success) {
          sessions = stored.data.sessions.map(item => restoreSession(JSON.stringify(item))).filter(Boolean);
          session = sessions.find(item => item.journeyId === stored.data.current) ?? null;
        } else {
          // One journey per tab (before several were kept): it becomes the first of the list.
          const single = restoreSession(raw);
          if (single) { sessions = [single]; session = single; }
        }
      } catch { sessions = []; session = null; }
      return session ? toSnapshot(session) : null;
    },
    /**
     * `openJourney(kind)` lets the caller keep a recognised service on the landing page (e.g. to show official
     * answers). `understanding`: already known (a chosen task). The same request again goes back to the
     * journey it opened instead of opening a second one.
     */
    async analyze(message, { signal, openJourney = () => true, understanding: known = null } = {}) {
      const understanding = known ?? await understand(message, { signal });
      const candidate = createSession(message, understanding, provider);
      const kind = journeyKind(candidate);
      if (!opensJourney(understanding, kind) || !openJourney(kind)) return { understanding, kind, snapshot: null };
      const same = sessions.find(item => item.story === candidate.story && journeyKind(item) === kind);
      return { understanding, kind, snapshot: commit(same ?? candidate), reused: Boolean(same) };
    },
    async understandTasks(message, { signal } = {}) {
      signal?.throwIfAborted();
      return splitTasks(message);
    },
    /** This tab's journeys, most recent first, in the same shape as the formal service lists them. */
    async listJourneys() {
      return sessions.map(item => ({ id: item.journeyId, current: item === session, unavailable: false, ...journeySummary(toSnapshot(item).journey) }));
    },
    async switchJourney(id) {
      session = find(id);
      save();
      return toSnapshot(session);
    },
    /** Clear one journey's demo data now. Returns how many journeys this tab still has. */
    forgetJourney(id) {
      sessions = sessions.filter(item => item.journeyId !== id);
      if (session?.journeyId === id) session = null;
      save();
      return sessions.length;
    },
    forgetCurrent() { return session ? this.forgetJourney(session.journeyId) : sessions.length; },
    /** The requests from one message, kept for a reload of this tab; identifiers are masked first. */
    saveTasks(state) {
      try {
        if (!state) { storage?.removeItem(tasksKey); return; }
        const split = { ...state.split, tasks: state.split.tasks.map(task => ({ ...task, input: redactIdentifiers(task.input) })) };
        storage?.setItem(tasksKey, JSON.stringify(StoredTasks.parse({ split, open: state.tasks.map(task => task.id), answered: (state.answered ?? []).map(task => task.id) })));
      } catch { /* not kept: the requests stay on the page until it is reloaded */ }
    },
    restoreTasks() {
      try {
        const { split, open, answered } = StoredTasks.parse(JSON.parse(storage?.getItem(tasksKey) ?? 'null'));
        const pick = ids => split.tasks.filter(task => ids.includes(task.id));
        return open.length || answered.length ? { split, tasks: pick(open), answered: pick(answered) } : null;
      } catch { return null; }
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
    async navigationPlan(sourceId) { return planNavigation({ sourceId }); },
    async handoffPreview() {
      requireSession();
      return { previewId: crypto.randomUUID?.() ?? String(Date.now()), status: 'awaiting_confirmation', summary: localHandoffSummary(toSnapshot(session).journey) };
    },
    async confirmHandoff(previewId) {
      return { previewId, status: 'confirmed', delivery: 'not_sent', confirmedAt: new Date().toISOString(), summary: localHandoffSummary(toSnapshot(requireSession()).journey) };
    },
    requestHandoff() { return commit(requestHandoff(requireSession())); },
    reset() { sessions = []; session = null; save(); this.saveTasks(null); },
    setFailNextDocument(value) { failNextDocument = Boolean(value); },
  };
}
