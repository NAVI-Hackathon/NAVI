import test from 'node:test';
import assert from 'node:assert/strict';
import { answersMessage } from './chatAnswers.js';
import { searchKnowledge } from '../../../../shared/knowledge/index.js';

test('a server retrieval reply without follow-up or highlights still becomes a complete message (NAVI-001)', () => {
  const entry = searchKnowledge('我搬家了，保單地址要怎麼改？').results[0];
  const message = answersMessage({ status: 'answered', results: [entry], related: [], hotline: '0800-012-899' }, '我要改地址',
    { notice: 'AI 分析服務暫時無法使用，以下是已核對來源的官網資料。', retry: { text: '我要改地址', label: '我要改地址' } });
  assert.equal(message.kind, 'answers');
  assert.equal(message.result.results[0].id, entry.id);
  assert.deepEqual(message.result.highlights, {});
  assert.equal(message.followUp.showAnswers, true);
  assert.ok(message.followUp.options.some(option => option.action === 'hotline'));
  assert.ok(message.notice && message.retry);
});

test('no usable entry (unknown source ids, empty or missing results) is a not-found message, never a crash', () => {
  for (const result of [null, {}, { results: [] }, { results: [undefined, { title: 'no id' }] }]) {
    const message = answersMessage(result, '我要改地址');
    assert.equal(message.result.status, 'not_found');
    assert.deepEqual(message.result.results, []);
    assert.ok(Array.isArray(message.followUp.options));
  }
});

test('local search answers keep their follow-up behaviour', () => {
  const broad = searchKnowledge('理賠要準備什麼文件');
  const message = answersMessage(broad, '理賠要準備什麼文件');
  assert.equal(message.followUp.showAnswers, false, 'several claim types ask which one first');
  assert.equal('notice' in message, false);
});
