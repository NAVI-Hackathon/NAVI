// Mask common identifiers before a description is kept in the browser.
// Same rules as the backend (apps/api/src/utils/privacy.js) so both sides keep the same text.
export const redactIdentifiers = text => String(text ?? '')
  .replace(/\b[A-Z][12]\d{8}\b/gi, '[已遮蔽身分證字號]')
  .replace(/\b09\d{2}[- ]?\d{3}[- ]?\d{3}\b/g, '[已遮蔽電話]')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[已遮蔽電子郵件]')
  .replace(/\b\d{4}(?:[- ]\d{4}){2,4}\b|\b\d{8,20}\b/g, '[已遮蔽識別資料]');
