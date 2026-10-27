import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseCsv, load, stats } from '../../../scripts/usability/summarize.js';

test('Usability statistics follow A protocol; assisted arrival is distinct from unaided success', () => {
  const s = stats([{ success: 1, time_s: 20, wrong_clicks: 0, help: 0, seq: 7, confidence: 6, correct_entry: 1 },
    { success: 0, time_s: 180, wrong_clicks: 2, help: 1, seq: 2, confidence: 3, correct_entry: 1 },
    { success: 1, time_s: 40, wrong_clicks: 1, help: 0, seq: 5, confidence: 5, correct_entry: 1 }]);
  assert.equal(s.completion, 2 / 3); assert.equal(s.medianTime, 30); assert.equal(s.correctEntry, 1); assert.equal(s.assistedCompletion, 1 / 3);
  assert.equal(s.wrongClicks, 1); assert.equal(s.help, 1 / 3); assert.equal(stats([]).completion, null);
  assert.equal(stats([{ success: 0, time_s: 180 }]).correctEntry, null);
});
test('Usability CSV rejects fractional indicators, duplicates, inconsistent arrival and broken quoting', t => {
  const dir = mkdtempSync(join(tmpdir(), 'navi-usability-')); t.after(() => rmSync(dir, { recursive: true }));
  const file = join(dir, 'records.csv'); const header = 'participant,condition,task,time_s,success,wrong_clicks,help,seq,confidence,correct_entry\n';
  for (const rows of ['P01,A,X1,20,0.5,0,0,7,7,1', 'P01,A,X1,20,1,0,0,7,7,0', 'P01,A,X1,20,1,0,0,7,7,1\nP01,A,X1,20,1,0,0,7,7,1']) {
    writeFileSync(file, header + rows); assert.ok(load(file).errors.length);
  }
  writeFileSync(file, header + 'P01,A,X1,20,1,0,0,7,7,1'); assert.equal(load(file).errors.length, 0);
  assert.deepEqual(parseCsv('a,b\n"with,comma","a""b"'), [['a', 'b'], ['with,comma', 'a"b']]);
  assert.throws(() => parseCsv('a\n"unclosed'));
});
test('Empty actual user records produce no measured benefit and incomplete pairs do not produce misleading deltas', t => {
  const dir = mkdtempSync(join(tmpdir(), 'navi-study-')); t.after(() => rmSync(dir, { recursive: true }));
  const file = join(dir, 'empty.csv'); const header = 'participant,condition,task,time_s,success,wrong_clicks,help,seq,confidence\n';
  const script = new URL('../../../scripts/usability/summarize.js', import.meta.url);
  writeFileSync(file, header); assert.match(execFileSync(process.execPath, [script.pathname, file], { encoding: 'utf8' }), /尚無資料/);
  writeFileSync(file, header + 'P01,A,X1,20,1,0,0,7,7\nP01,B,Y1,10,1,0,0,7,7');
  assert.match(execFileSync(process.execPath, [script.pathname, file], { encoding: 'utf8' }), /不列入配對差異/);
});
