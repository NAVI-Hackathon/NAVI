import { createJourneyService } from './naviService.js';
import { createApiJourneyService } from './apiJourney.js';
import { understandIntent } from './intelligence.js';
import { mockUnderstanding } from '../mocks/understanding.js';

function safeSessionStorage() {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

/** Mock Adapter: no network. Golden Path is always reproducible, even with the API down. */
export function createMockAdapter({ storage = safeSessionStorage(), analysisDelayMs = 650, documentDelayMs = 1000 } = {}) {
  return createJourneyService({
    mode: 'demo', storage, storageKey: 'navi.demo.journey', documentDelayMs,
    understand: (message, { signal } = {}) => new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const timer = setTimeout(() => resolve(mockUnderstanding(message)), analysisDelayMs);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    }),
  });
}

/** Real API Adapter: intent, journey, documents and readiness all come from apps/api. */
export function createApiAdapter({ storage = (()=>{try{return globalThis.localStorage??safeSessionStorage();}catch{return safeSessionStorage();}})(), ...options } = {}) {
  return createApiJourneyService({
    storage, ...options,
    understand: (message, { signal } = {}) => understandIntent(message, { signal }),
  });
}

export function isDemoPath(pathname) {
  return /^\/demo\/?$/.test(pathname);
}

export function isEmbedPath(pathname) {
  return /^\/embed\/?$/.test(pathname);
}

/** /demo → demo; /embed?mode=demo → demo; everything else uses the real API. */
export function resolveMode(location) {
  if (isEmbedPath(location.pathname)) return new URLSearchParams(location.search).get('mode') === 'demo' ? 'demo' : 'live';
  return isDemoPath(location.pathname) ? 'demo' : 'live';
}
