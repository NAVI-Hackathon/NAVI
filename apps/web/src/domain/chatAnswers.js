// The one shape of an "answers" chat message, whether the official answers come from the local search
// (/demo, and before the backend answers) or from the server's retrieval (formal mode, also when the AI
// could not answer). The chat renders only this shape, so a reply with no follow-up, no results or
// entries this snapshot does not know can never break the page.
import { followUpForAnswers } from './followUps.js';

/**
 * @param {{ results?: object[], related?: object[], highlights?: Record<string, string[]>, hotline?: string } | null} result
 * @param {string} askedText what the user asked (follow-up options carry it as context)
 * @param {{ notice?: string, retry?: { text: string, label: string } }} [extra]
 */
export function answersMessage(result, askedText, { notice, retry } = {}) {
  const results = Array.isArray(result?.results) ? result.results.filter(entry => entry?.id) : [];
  const related = Array.isArray(result?.related) ? result.related.filter(entry => entry?.id) : [];
  const safe = {
    status: results.length ? 'answered' : 'not_found',
    results,
    related,
    highlights: result?.highlights && typeof result.highlights === 'object' ? result.highlights : {},
    hotline: typeof result?.hotline === 'string' ? result.hotline : '',
  };
  return {
    kind: 'answers',
    result: safe,
    followUp: followUpForAnswers(safe, askedText),
    ...(notice ? { notice } : {}),
    ...(retry ? { retry } : {}),
  };
}
