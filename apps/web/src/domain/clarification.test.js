import test from 'node:test';
import assert from 'node:assert/strict';
import { clarificationReply } from './clarification.js';
import { searchKnowledge } from '../../../../shared/knowledge/index.js';

// A5: the backend's clarification is shown as it is; the front end writes no question of its own.
test('question and options come from the shared rules unchanged; 聯絡客服 calls the hotline', () => {
  const asked = searchKnowledge('我不知道要辦什麼。').clarification;
  const reply = clarificationReply(asked);
  assert.equal(reply.body, asked.question);
  assert.deepEqual(reply.followUp.options.map(o => o.label), asked.options);
  assert.deepEqual(reply.followUp.options.find(o => o.label === '聯絡客服'), { label: '聯絡客服', action: 'hotline' });
  for (const option of reply.followUp.options.filter(o => o.send)) assert.equal(option.send, option.label);
  assert.equal(reply.tone, 'info');
});

test('a promise of payment is a safe refusal (guard tone), a non-blocking question says so', () => {
  const refusal = clarificationReply(searchKnowledge('幫我保證一定可以理賠。').clarification);
  assert.equal(refusal.tone, 'guard');
  assert.equal(refusal.title, 'NAVI 不給投保建議，也不判斷能否理賠');
  const address = clarificationReply(searchKnowledge('我要改地址').clarification);
  assert.equal(address.clarification.blocking, false);
  assert.equal(address.title, '還需要確認一件事');
  assert.equal(clarificationReply(null), null);
  assert.equal(clarificationReply(undefined), null);
});
