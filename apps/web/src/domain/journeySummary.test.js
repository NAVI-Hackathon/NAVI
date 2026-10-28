import test from 'node:test';
import assert from 'node:assert/strict';
import { journeySummaryText, summaryFileName } from './journeySummary.js';

const requirement = (id, name, status, required = true) => ({ id, name, description: '', required, status, weight: 0 });
const official = { url: 'https://life.cardif.com.tw/claims', title: '理賠服務', retrievedAt: '2026-10-21' };
const snapshot = (kind, overrides = {}) => ({
  context: { kind },
  journey: {
    title: '住院醫療理賠', currentStage: 'EVIDENCE_COLLECTION', supported: true, readiness: 35,
    requirements: [requirement('incident', '事故說明', 'verified'), requirement('diagnosis_certificate', '診斷書或住院證明', 'missing'), requirement('receipt', '醫療收據', 'missing', false)],
    documents: [{ id: '00000000-0000-4000-8000-000000000001', documentType: 'diagnosis_certificate', filename: 'a.pdf', fields: { patientName: '王小明', hospitalName: '臺大醫院' }, status: 'needs_review' }],
    consistencyIssues: [], sources: [], officialSources: [official],
    nextAction: { type: 'UPLOAD_DOCUMENT', target: 'diagnosis_certificate', title: '上傳診斷書', description: '請上傳診斷書或住院證明。', destination: undefined },
    summary: '我在臺大醫院住院三天',
    ...overrides,
  },
});

test('the summary lists the service, stage, items, next step and official source', () => {
  const text = journeySummaryText(snapshot('hospital'));
  for (const line of ['服務：住院醫療理賠', 'NAVI 資料準備度 35%，非核賠結果', '・事故說明：已完成', '・診斷書或住院證明：尚缺', '依情況需要：', '・醫療收據：尚缺', '下一步：上傳診斷書', '官方來源：理賠服務（擷取 2026-10-21）https://life.cardif.com.tw/claims', '不代表已送件']) {
    assert.ok(text.includes(line), line);
  }
});

test('nothing read from documents or the user’s description is included', () => {
  const text = journeySummaryText(snapshot('hospital'));
  for (const value of ['王小明', '臺大醫院', 'a.pdf', '我在臺大醫院住院三天']) assert.ok(!text.includes(value), value);
});

test('a service without a document workflow has no score', () => {
  const text = journeySummaryText(snapshot('change_address', { currentStage: 'SERVICE_IDENTIFIED', requirements: [], documents: [] }));
  assert.ok(!text.includes('%'));
  assert.ok(text.includes('目前狀態：已找到相關服務'));
});

test('the file name carries the date', () => {
  assert.equal(summaryFileName(new Date('2026-10-28T03:00:00Z')), 'NAVI-辦理摘要-2026-10-28.txt');
});
