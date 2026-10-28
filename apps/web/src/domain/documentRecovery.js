// What the user can do after an upload or recognition failed, by the server's error code. The message
// itself is the server's (written for the user); this only picks the actions the card offers.
// Nothing is re-sent on its own: "retry" sends the same file again only when the user presses it.

const reselect = ['EMPTY_DOCUMENT', 'DOCUMENT_TOO_LARGE', 'UNSUPPORTED_FILE_TYPE', 'DOCUMENT_INVALID', 'INVALID_INPUT'];
const wrongDocument = ['DOCUMENT_TYPE_MISMATCH', 'DOCUMENT_SERVICE_MISMATCH', 'DOCUMENT_UNRECOGNIZED'];
const transient = ['AI_TIMEOUT', 'NETWORK_ERROR', 'API_UNAVAILABLE', 'API_ERROR', 'AI_PROVIDER_ERROR', 'AI_UNAVAILABLE', 'AI_RESPONSE_INVALID', 'RATE_LIMITED'];
const noRecognition = ['DOCUMENT_INTELLIGENCE_NOT_AVAILABLE', 'DOCUMENT_RECOGNITION_UNAVAILABLE'];
const quota = ['AI_DAILY_LIMIT_REACHED', 'AI_SESSION_LIMIT_REACHED', 'AI_USAGE_UNAVAILABLE', 'AI_BUSY'];

/**
 * @returns {{ kind: string, title: string, fallback: string, actions: string[] }}
 *   actions, in order of preference: 'reselect' (choose another file), 'retry' (send the same file again),
 *   'manual' (provide the information, unverified), 'handoff' (a specialist continues).
 */
export function documentRecovery(code) {
  if (reselect.includes(code)) return { kind: 'file', title: '這個檔案無法使用', fallback: '請選擇 PDF、PNG、JPG 或 WebP，10 MB 以內。', actions: ['reselect'] };
  if (wrongDocument.includes(code)) return { kind: 'document', title: '這份文件不是這裡需要的文件', fallback: '請確認文件種類後重新選擇。', actions: ['reselect', 'manual', 'handoff'] };
  if (code === 'JOURNEY_BUSY') return { kind: 'busy', title: '另一份資料正在分析', fallback: '請等目前的分析完成，再試一次。', actions: ['retry'] };
  if (code === 'BANK_INFORMATION_MISMATCH') return { kind: 'conflict', title: '文件與你先前提供的資訊不一致', fallback: '請確認先前提供的資訊，或由專員協助。', actions: ['manual', 'reselect', 'handoff'] };
  if (noRecognition.includes(code)) return { kind: 'unavailable', title: '目前無法辨識上傳的文件', fallback: '可以先提供資訊（尚未驗證），或由專員協助。', actions: ['manual', 'handoff'] };
  if (quota.includes(code)) return { kind: 'quota', title: '目前無法進行 AI 辨識', fallback: '今日或這次體驗的辨識額度已用完，可以先提供資訊，或稍後再試。', actions: ['manual', 'handoff'] };
  if (transient.includes(code)) return { kind: 'transient', title: '這次沒有完成辨識', fallback: '連線或服務暫時不穩定，可以用同一份文件再試一次。', actions: ['retry', 'reselect'] };
  return { kind: 'unknown', title: '暫時無法辨識這份文件', fallback: '可以重新上傳較清楚的文件，或先提供資訊。', actions: ['reselect', 'retry', 'manual'] };
}

/** Field values the recognition did not find (null / empty): shown as 未辨識, never filled in by NAVI. */
export function unrecognizedFields(fields, names) {
  return names.filter(name => fields[name] === null || fields[name] === undefined || fields[name] === '');
}
