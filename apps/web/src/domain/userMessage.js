// What a failure says on screen (NAVI-011). Server messages are written for the user in Traditional
// Chinese; an error code, an English message or a stack never reaches the page — the caller's own copy is
// shown instead. The code itself stays on the error for diagnostics.
const HAN = /\p{Script=Han}/u;

export function userMessage(error, fallback) {
  const text = typeof error === 'string' ? error : error?.message;
  return typeof text === 'string' && HAN.test(text) ? text : fallback;
}
