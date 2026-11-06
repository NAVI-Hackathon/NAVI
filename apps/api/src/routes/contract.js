// Keep the original strict Zod clients compatible, including already-open tabs.
export function acceptsJudgeContract(req, res) {
  res.vary('X-NAVI-Contract');
  return req.get('X-NAVI-Contract') === 'judge-v1';
}

export function legacyEvidence({ clarification: _clarification, ...evidence }) {
  return evidence;
}

export function legacyConversation({ failure: _failure, clarification: _clarification, evidence, ...reply }) {
  return { ...reply, evidence: legacyEvidence(evidence) };
}
