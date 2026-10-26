// Migration regression: the original Frontend assertions run unchanged against shared retrieval.
import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeEntries, searchKnowledge } from '../../../shared/knowledge/index.js';
import raw from '../../../data/cardif_public_data.json' with { type: 'json' };

const top = query => searchKnowledge(query).results[0]?.id;

test('the index covers every service, form, FAQ and claim requirement in the data file', () => {
  const count = type => knowledgeEntries.filter(e => e.type === type).length;
  assert.equal(count('service'), raw.services.length);
  assert.equal(count('form'), raw.forms.length);
  assert.equal(count('faq'), raw.faq.length);
  assert.equal(count('claim_documents'), Object.keys(raw.claim_document_requirements).length);
  assert.equal(count('claim_rule'), raw.claim_general_rules.length);
  assert.equal(new Set(knowledgeEntries.map(e => e.id)).size, knowledgeEntries.length);
});

test('answers are quoted from the data file, never written by NAVI', () => {
  for (const entry of knowledgeEntries.filter(e => e.type === 'faq')) {
    assert.ok(raw.faq.some(f => f.q === entry.title && f.a === entry.summary), entry.id);
  }
  for (const entry of knowledgeEntries.filter(e => e.type === 'service')) {
    const service = raw.services.find(s => s.name === entry.title);
    const quoted = [...service.channels, ...service.documents, ...service.notes, ...(service.online_requirements ?? []), service.apply_time, service.effective_time, service.online_available];
    for (const detail of entry.details) for (const item of detail.items) assert.ok(quoted.includes(item), `${entry.id}: ${item}`);
  }
});

test('everyday questions find the matching official item', () => {
  const cases = [
    ['我搬家了要改地址', 'service:change_address'],
    ['我想借錢週轉', 'service:policy_loan'],
    ['我想把年繳改月繳', 'service:change_payment_frequency'],
    ['換工作要通知你們嗎', 'service:change_occupation'],
    ['我想改成信用卡扣款', 'service:change_payment_method'],
    ['要保人可以改成我小孩嗎', 'service:change_policyholder'],
    ['家人過世不知道有沒有保險', 'service:claim_household_registration'],
    ['受益人變更表單在哪下載', 'form:form_beneficiary_change'],
    ['保險金申請書', 'form:claim_1.1.1'],
    ['保單借款多久撥款', 'faq:12'],
    ['理賠要多久？', 'faq:11'],
    ['密碼輸錯被鎖住了', 'faq:7'],
    ['客服電話幾號', 'faq:10'],
    ['住院要準備什麼文件', 'claim-doc:2'],
    ['癌症理賠需要哪些文件', 'claim-doc:3'],
    // Suggested questions in the assistant panel and landing scenarios.
    ['醫起通是什麼？', 'service:claim_hospital_upload'],
    ['線上申請還要寄正本嗎？', 'service:claim_union_chain'],
    ['我最近搬家了，保單上的地址要怎麼改？', 'service:change_address'],
    ['我想用保單借錢週轉，要準備什麼？', 'service:policy_loan'],
  ];
  for (const [query, expected] of cases) assert.equal(top(query), expected, query);
});

test('advice and claim judgments are refused; unrelated or vague questions find nothing', () => {
  for (const query of ['推薦我買哪張保單', '我住院能不能賠', '我要買車險', '理賠金額是多少']) {
    assert.equal(searchKnowledge(query).status, 'out_of_scope', query);
  }
  for (const query of ['今天天氣如何', '保單', '我想問一下保險', '班機延誤可以申請嗎', '', '   ']) {
    const result = searchKnowledge(query);
    assert.equal(result.status, 'not_found', query);
    assert.equal(result.results.length, 0);
  }
  assert.equal(searchKnowledge('你好').hotline, raw.contacts.hotline);
});

test('results come with related items and at most three answers', () => {
  const result = searchKnowledge('保單借款');
  assert.equal(result.status, 'answered');
  assert.ok(result.results.length <= 3);
  assert.ok(result.related.some(e => e.id === 'form:form_policy_loan'));
  assert.ok(result.related.every(e => !result.results.includes(e)));
});
