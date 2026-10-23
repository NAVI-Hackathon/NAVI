import test from 'node:test';
import assert from 'node:assert/strict';
import { searchKnowledge } from '../../../../shared/knowledge/index.js';
import { followUpForAnswers, followUpForClarification, followUpForRefusal } from './followUps.js';

test('a broad claim question becomes a follow-up question, and each choice narrows the search', () => {
  const asked = '理賠要準備什麼文件';
  const followUp = followUpForAnswers(searchKnowledge(asked), asked);
  assert.equal(followUp.showAnswers, false);
  assert.match(followUp.question, /哪一種/);
  assert.equal(followUp.options[0].label, '住院醫療', 'the end-to-end service comes first');
  assert.equal(followUp.options.at(-1).action, 'hotline');
  const outpatient = followUp.options.find(o => o.label === '醫療門診');
  assert.ok(outpatient.send.startsWith(asked), 'the choice keeps what the user asked');
  assert.equal(searchKnowledge(outpatient.send).results[0].id, 'claim-doc:1');
  assert.equal(searchKnowledge(followUp.options[0].send).results[0].id, 'claim-doc:2');
});

test('a specific answer is shown, with related entries and a human option as next steps', () => {
  const followUp = followUpForAnswers(searchKnowledge('我想改地址'), '我想改地址');
  assert.equal(followUp.showAnswers, true);
  assert.deepEqual(followUp.options.map(o => o.label), ['保險契約內容變更申請書', '找真人客服']);
  assert.equal(searchKnowledge(followUp.options[0].send).results[0].title, '保險契約內容變更申請書');
});

test('clarification keeps the context; refusals offer starters and a human', () => {
  const clarify = followUpForClarification('我有問題');
  assert.ok(clarify.options.every(o => o.action === 'hotline' || o.send.startsWith('我有問題。')));
  assert.equal(followUpForRefusal().options.at(-1).action, 'hotline');
});
