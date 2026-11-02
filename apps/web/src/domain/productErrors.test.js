import test from 'node:test';
import assert from 'node:assert/strict';
import { errorNotice, productErrors, reloadCodes } from './productErrors.js';

test('every A3 conflict asks for a reload and has its own copy', () => {
  for (const code of ['TASK_STALE', 'IDEMPOTENCY_CONFLICT', 'CONVERSATION_INCOMPLETE', 'JOURNEY_BUSY']) {
    assert.ok(reloadCodes.has(code), code);
    assert.match(productErrors[code][1], /重新載入/, code);
  }
  assert.ok(!reloadCodes.has('STORAGE_UNAVAILABLE'), 'a storage outage is retried later, not reloaded');
});

test('errorNotice: our copy for known codes, the server message otherwise, then the fallback', () => {
  assert.equal(errorNotice({ code: 'STORAGE_UNAVAILABLE', message: 'generic' }), 'NAVI 暫時無法存取保存的資料：你的資料沒有被變更，請稍後再試一次。');
  assert.equal(errorNotice({ code: 'SOMETHING_NEW', message: '伺服器說明' }), '伺服器說明');
  assert.equal(errorNotice(new TypeError('Failed to fetch'), '請確認網路'), '請確認網路');
});
