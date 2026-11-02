import test from 'node:test';
import assert from 'node:assert/strict';
import { userMessage } from './userMessage.js';
import { documentRecovery } from './documentRecovery.js';
import { createMockAdapter } from '../services/adapters.js';

// NAVI-011: no error code, English message or stack on screen; the code stays on the error.
const RAW = /[A-Z]{2,}_[A-Z_]+|Error:|at \S+ \(/;

test('only Traditional Chinese messages are shown; anything else falls back', () => {
  assert.equal(userMessage({ code: 'JOURNEY_BUSY', message: '另一份資料正在分析。' }, 'x'), '另一份資料正在分析。');
  for (const raw of ['DOCUMENT_RECOGNITION_FAILED', 'Failed to fetch', 'TypeError: x is undefined\n    at f (a.js:1)', '', null, undefined, 42]) {
    assert.equal(userMessage({ message: raw }, '請稍後再試。'), '請稍後再試。', String(raw));
    assert.equal(userMessage(raw, null), null, String(raw));
  }
});

test('demo: a failed recognition says why in Chinese and offers retry, reselect and manual entry', async () => {
  const map = new Map();
  const service = createMockAdapter({ storage: { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }, analysisDelayMs: 0, documentDelayMs: 0 });
  await service.analyze('我住院了，想申請理賠');
  service.setFailNextDocument(true);
  const error = await service.uploadDocument('bank_passbook', { sample: true }).catch(e => e);
  assert.equal(error.code, 'DOCUMENT_RECOGNITION_FAILED');
  assert.doesNotMatch(userMessage(error, ''), RAW);
  assert.match(userMessage(error, ''), /\p{Script=Han}/u);
  const recovery = documentRecovery(error.code);
  assert.deepEqual(recovery.actions, ['retry', 'reselect', 'manual']);
  assert.doesNotMatch(recovery.title + recovery.fallback, RAW);
});

test('every recovery copy is Chinese, never a code', () => {
  for (const code of ['EMPTY_DOCUMENT', 'DOCUMENT_TYPE_MISMATCH', 'JOURNEY_BUSY', 'BANK_INFORMATION_MISMATCH', 'DOCUMENT_RECOGNITION_UNAVAILABLE', 'AI_DAILY_LIMIT_REACHED', 'AI_TIMEOUT', 'DOCUMENT_RECOGNITION_FAILED', 'SOMETHING_NEW', null]) {
    const { title, fallback } = documentRecovery(code);
    assert.doesNotMatch(title + fallback, RAW, String(code));
  }
});

test('formal-mode notices: known codes have our copy; an unknown code never shows the raw message', async () => {
  const { errorNotice } = await import('./productErrors.js');
  assert.match(errorNotice({ code: 'SESSION_EXPIRED', message: 'SESSION_EXPIRED' }), /登入已過期/);
  assert.equal(errorNotice({ code: 'SOMETHING_NEW', message: 'SOMETHING_NEW' }, '請稍後再試。'), '請稍後再試。');
  assert.equal(errorNotice({ code: 'SOMETHING_NEW', message: '伺服器說明。' }), '伺服器說明。');
});
