// What NAVI says for the persistent service's errors (A3 contract). [title, body] like errorCopy in App.
// The server's own messages stay generic on purpose; these say what happened and what the user can do.

export const productErrors = {
  AUTH_REQUIRED: ['請先登入', '登入後才能查看與保存你的服務歷程；NAVI 不會自動重送剛才的內容。'],
  SESSION_EXPIRED: ['登入已過期', '請重新登入後再繼續；NAVI 不會自動重送剛才的內容。'],
  EMAIL_NOT_VERIFIED: ['電子郵件尚未驗證', '完成信箱驗證後，才能使用帳號保存的服務歷程。'],
  TASK_STALE: ['這件事已在其他地方更新', '請按「重新載入」查看最新狀態再決定下一步；NAVI 不會自動重送。'],
  IDEMPOTENCY_CONFLICT: ['這個操作已經處理過', '為避免重複建立，這次沒有再處理。請按「重新載入」查看結果。'],
  CONVERSATION_INCOMPLETE: ['上一則訊息還沒有處理完成', '請按「重新載入」查看對話的最新狀態後再傳送。'],
  JOURNEY_BUSY: ['這件事正在處理其他操作', '請稍候幾秒，再按「重新載入」查看最新狀態。'],
  STORAGE_UNAVAILABLE: ['NAVI 暫時無法存取保存的資料', '你的資料沒有被變更，請稍後再試一次。'],
  DATA_INTEGRITY_ERROR: ['這筆資料暫時無法安全讀取', '為保護你的資料，NAVI 已停止使用這筆紀錄。請改從新的一件事開始，或洽客服專線。'],
  ACCOUNT_REGISTRATION_UNAVAILABLE: ['目前還不能註冊帳號', '公開註冊尚未開放；已提供的測試帳號可以登入，不登入也能繼續使用。'],
  MAIL_UNAVAILABLE: ['目前無法寄送電子郵件', '驗證信與密碼重設信暫時無法寄出，請稍後再試。'],
};

/** Conflicts: another tab, device or request already changed things. Read the latest state; never re-send. */
export const reloadCodes = new Set(['TASK_STALE', 'IDEMPOTENCY_CONFLICT', 'CONVERSATION_INCOMPLETE', 'JOURNEY_BUSY']);

/** One line for a toast or an inline alert: ours when we know the code, else the server's message. */
export function errorNotice(error, fallback = '目前暫時無法處理，請稍後再試。') {
  const copy = productErrors[error?.code];
  if (copy) return `${copy[0]}：${copy[1]}`;
  return error?.message && error?.code ? error.message : fallback;
}
