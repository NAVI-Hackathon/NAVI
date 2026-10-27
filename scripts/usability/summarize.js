// Summarises the usability record sheet (docs/usability/protocol.md): per condition and per task,
// completion rate, median time of successful attempts, wrong clicks, help, SEQ and confidence, and each
// participant's difference between conditions. Descriptive only — no significance claims for small samples.
// Usage: node scripts/usability/summarize.js docs/usability/record-sheet.csv
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TASKS = ['X1', 'X2', 'X3', 'Y1', 'Y2', 'Y3'];
const CAP = 180;

/** Minimal CSV parser: quoted fields may hold commas, quotes and new lines. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (quoted) throw Error('CSV 含有未關閉的引號');
  if (row.some(cell => cell.trim())) rows.push(row);
  return rows;
}

export function load(file) {
  const [header, ...lines] = parseCsv(readFileSync(file, 'utf8'));
  const records = [], errors = [], seen = new Set();
  lines.forEach((cells, index) => {
    const r = Object.fromEntries(header.map((key, k) => [key.trim(), (cells[k] ?? '').trim()]));
    const where = `第 ${index + 2} 列（${r.participant || '?'} ${r.task || '?'}）`;
    const num = (key, lo, hi) => {
      const v = Number(r[key]);
      if (r[key] === '' || !Number.isFinite(v) || v < lo || v > hi) errors.push(`${where}：${key} 應為 ${lo}～${hi}，實際為「${r[key]}」`);
      return v;
    };
    if (!/^P\d{2}$/.test(r.participant)) errors.push(`${where}：participant 應為 P01 這種格式`);
    if (!['A', 'B'].includes(r.condition)) errors.push(`${where}：condition 應為 A 或 B`);
    if (!TASKS.includes(r.task)) errors.push(`${where}：task 應為 ${TASKS.join('/')}`);
    const id = `${r.participant}:${r.condition}:${r.task}`;
    if (seen.has(id)) errors.push(`${where}：相同受試者、條件及任務重複`);
    seen.add(id);
    if (r.task && r.task_set && r.task[0] !== r.task_set) errors.push(`${where}：task 與 task_set 不一致`);
    const rec = { ...r, time_s: num('time_s', 0, CAP), success: num('success', 0, 1), wrong_clicks: num('wrong_clicks', 0, 99), help: num('help', 0, 1), seq: num('seq', 1, 7), confidence: num('confidence', 1, 7) };
    for (const key of ['success', 'wrong_clicks', 'help', 'seq', 'confidence']) if (!Number.isInteger(rec[key])) errors.push(`${where}：${key} 必須為整數`);
    if (rec.help === 1 && rec.success === 1) errors.push(`${where}：有協助時 success 應為 0`);
    rec.correct_entry = r.correct_entry ? num('correct_entry', 0, 1) : null;
    if (rec.correct_entry !== null && !Number.isInteger(rec.correct_entry)) errors.push(`${where}：correct_entry 必須為 0 或 1`);
    if (rec.success === 1 && rec.correct_entry === 0) errors.push(`${where}：success 與 correct_entry 不一致`);
    records.push(rec);
  });
  return { records, errors };
}

const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt = (v, digits = 1, unit = '') => (v === null ? '—' : `${v.toFixed(digits)}${unit}`);

export function stats(rows) {
  const ok = rows.filter(r => r.success === 1);
  return {
    attempts: rows.length,
    completion: rows.length ? ok.length / rows.length : null,
    medianTime: median(ok.map(r => r.time_s)),
    wrongClicks: mean(rows.map(r => r.wrong_clicks)),
    help: rows.length ? rows.filter(r => r.help === 1).length / rows.length : null,
    seq: mean(rows.map(r => r.seq)),
    confidence: mean(rows.map(r => r.confidence)),
    // Arrival is not inferred from help: A's success explicitly excludes assisted completion.
    correctEntryObservations: rows.filter(r => r.correct_entry !== null && r.correct_entry !== undefined).length,
    correctEntry: mean(rows.filter(r => r.correct_entry !== null && r.correct_entry !== undefined).map(r => r.correct_entry)),
    assistedCompletion: mean(rows.filter(r => r.correct_entry !== null && r.correct_entry !== undefined).map(r => Number(r.help === 1 && r.correct_entry === 1))),
  };
}

function line(label, s) {
  return `${label.padEnd(10)} 次數 ${String(s.attempts).padStart(2)}｜完成率 ${fmt(s.completion === null ? null : s.completion * 100, 0, '%')}｜完成時間中位數 ${fmt(s.medianTime, 0, ' 秒')}｜錯誤點擊平均 ${fmt(s.wrongClicks)}｜需協助 ${fmt(s.help === null ? null : s.help * 100, 0, '%')}｜難易度 ${fmt(s.seq)}／7｜信心 ${fmt(s.confidence)}／7`;
}

function main() {
  const file = process.argv[2] ?? 'docs/usability/record-sheet.csv';
  const { records, errors } = load(file);
  if (errors.length) {
    console.error(`紀錄表有 ${errors.length} 個問題，請先修正：\n- ${errors.join('\n- ')}`);
    process.exit(1);
  }
  if (!records.length) { console.log('紀錄表尚無資料：測試完成後再執行。'); return; }
  const people = [...new Set(records.map(r => r.participant))].sort();
  const orders = Object.entries(Object.groupBy(people.map(p => records.find(r => r.participant === p)), r => r.order || '?')).map(([o, rs]) => `順序 ${o}：${rs.length} 人`);
  const out = [`受試者 ${people.length} 人（${orders.join('，')}）；紀錄 ${records.length} 筆。描述統計，樣本少於 10 人時不做顯著性推論。`, ''];
  out.push('■ 依條件（A＝不使用 NAVI，B＝使用 NAVI，示範模式）');
  for (const c of ['A', 'B']) {
    const s = stats(records.filter(r => r.condition === c));
    out.push(line(`條件 ${c}`, s));
    out.push(`正確入口到達率 ${fmt(s.correctEntry === null ? null : s.correctEntry * 100, 0, '%')}｜協助後完成比例 ${fmt(s.assistedCompletion === null ? null : s.assistedCompletion * 100, 0, '%')}（另記 correct_entry ${s.correctEntryObservations} 筆；未記錄時不推測）`);
  }
  out.push('', '■ 依任務類型');
  for (const k of ['1', '2', '3']) {
    const name = { 1: '找服務入口', 2: '找應備文件', 3: '找表單下載' }[k];
    for (const c of ['A', 'B']) out.push(line(`${name}${c}`, stats(records.filter(r => r.task.endsWith(k) && r.condition === c))));
  }
  out.push('', '■ 每位受試者（B − A：總時間、完成題數、錯誤點擊）');
  for (const p of people) {
    const sum = (c, key) => records.filter(r => r.participant === p && r.condition === c).reduce((a, r) => a + r[key], 0);
    const has = c => records.some(r => r.participant === p && r.condition === c);
    if (!has('A') || !has('B')) { out.push(`${p}：只有一個條件的資料，不列入比較`); continue; }
    const rows = records.filter(r => r.participant === p);
    if (['A', 'B'].some(c => rows.filter(r => r.condition === c).length !== 3) || new Set(rows.map(r => r.task)).size !== 6) { out.push(`${p}：兩條件的任務不完整或不平衡，不列入配對差異`); continue; }
    const d = key => sum('B', key) - sum('A', key);
    out.push(`${p}（順序 ${records.find(r => r.participant === p).order || '?'}）：時間 ${d('time_s') >= 0 ? '+' : ''}${d('time_s')} 秒｜完成 ${d('success') >= 0 ? '+' : ''}${d('success')} 題｜錯誤點擊 ${d('wrong_clicks') >= 0 ? '+' : ''}${d('wrong_clicks')}`);
  }
  console.log(out.join('\n'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
