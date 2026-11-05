// A5: when NAVI cannot tell which service is meant (or is asked to promise a claim), it shows the
// clarification as the backend wrote it — question and options come from shared/knowledge/clarification.js
// (the same rules the server runs) or from the server's reply, never from here. Presentation only.
//   blocking: no service is chosen yet, so there are no sources to follow and no navigation.
//   not blocking: the sources shown still apply; this only asks which kind (it is not eligibility).
// A chosen option is sent back as the user's own words through the same chat (formal: the Conversation
// API, same conversation, a new request) — the backend decides again.

const HOTLINE_OPTIONS = new Set(['聯絡客服']);

/** @returns {object|null} a chat note with the question and its options, or null without a clarification. */
export function clarificationReply(clarification) {
  if (!clarification?.question) return null;
  const { reason, blocking, question, options = [] } = clarification;
  const refusal = reason === 'insurance_decision';
  return {
    kind: 'note',
    // A refused promise is a safe answer, not an error.
    tone: refusal ? 'guard' : 'info',
    title: refusal ? 'NAVI 不判斷能否理賠' : blocking ? '先確認一下' : '還需要確認一件事',
    body: question,
    clarification: { reason, blocking },
    followUp: { options: options.map(option => (HOTLINE_OPTIONS.has(option) ? { label: option, action: 'hotline' } : { label: option, send: option })) },
  };
}
