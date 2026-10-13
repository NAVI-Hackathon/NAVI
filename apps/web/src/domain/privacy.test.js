import test from 'node:test';
import assert from 'node:assert/strict';
import { redactIdentifiers } from './privacy.js';

test('identifiers are masked; hospital names, dates and stay length are kept', () => {
  const text = '我在台中榮總住院五天（2026-10-01 入院），身分證A123456789、電話0912-345-678、信箱 a.b@example.com、帳號 012345678901';
  const masked = redactIdentifiers(text);
  for (const secret of ['A123456789', '0912-345-678', 'a.b@example.com', '012345678901']) assert.ok(!masked.includes(secret), secret);
  assert.match(masked, /台中榮總住院五天（2026-10-01 入院）/);
  assert.equal(redactIdentifiers('我住院了想申請理賠'), '我住院了想申請理賠');
});
