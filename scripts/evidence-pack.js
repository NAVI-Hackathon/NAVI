import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import os from 'node:os';

export const evidenceJobs = Object.freeze([
  ['tests', ['test']], ['lint', ['run', 'lint']], ['build', ['run', 'build:all']],
  ['legacy', ['run', 'eval:ai:local']], ['hospitalization', ['run', 'eval:hospitalization']],
  ['knowledge', ['run', 'eval:knowledge']], ['shared-browser', ['run', 'test:shared:browser']],
]);
export function latencySummary(samples) {
  if (!samples.length || samples.some(value => !Number.isFinite(value) || value < 0)) throw Error('Invalid latency samples');
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples: sorted.length, p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1] };
}
export function parseReport(output) {
  const start = output.indexOf('{\n');
  if (start < 0) throw Error('Missing JSON report');
  return JSON.parse(output.slice(start));
}
const hash = text => createHash('sha256').update(text).digest('hex');
export async function generateEvidencePack() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = resolve(root, 'artifacts/demo-evidence', new Date().toISOString().replaceAll(':', '-'));
  await mkdir(output, { recursive: true });
  const git = args => {
    const child = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (child.status !== 0) throw Error('Git provenance check failed');
    return child.stdout.trim();
  };
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD|GEMINI|GOOGLE|VERTEX|OPENAI|NODE_OPTIONS/.test(key)));
  Object.assign(env, { AI_MODE: 'demo', ALLOW_PAID_AI: 'false', CI: 'true', NEXT_TELEMETRY_DISABLED: '1', NODE_OPTIONS: `--import=${new URL('../apps/api/test/networkGuard.js', import.meta.url).href}` });
  const jobs = [];
  let error = null;
  const run = (id, command, args) => {
    console.log(`Running ${id}`);
    const started = performance.now();
    const child = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 240000, maxBuffer: 12 * 1024 * 1024 });
    const log = (child.stdout ?? '') + (child.stderr ?? '');
    jobs.push({ id, command: [command === process.execPath ? 'node' : command, ...args], exitCode: child.status, signal: child.signal, elapsedMs: performance.now() - started, logSha256: hash(log) });
    if (child.error || child.status !== 0) error = `${id} failed`;
    return { log, stdout: child.stdout ?? '' };
  };
  const inputs = {};
  for (const path of ['data/cardif_seed_data.json', 'apps/api/eval/cases.jsonl', 'apps/api/eval/hospitalization/cases.jsonl', 'apps/api/eval/knowledge/cases.jsonl']) inputs[path] = hash(await readFile(resolve(root, path)));
  const provenance = { commit: git(['rev-parse', 'HEAD']), workingTreeDirty: Boolean(git(['status', '--porcelain'])), trackedDiffSha256: hash(git(['diff', 'HEAD'])), runtime: process.version, os: `${os.platform()}/${os.arch()}`, inputs };
  const reports = {};
  for (const [id, args] of evidenceJobs) {
    const { log, stdout } = run(id, 'npm', args); await writeFile(resolve(output, `${id}.log`), log);
    if (['legacy', 'hospitalization', 'knowledge'].includes(id) && !error) {
      try { reports[id] = parseReport(stdout); } catch { error = `${id} report invalid`; }
    }
    if (error) break;
  }
  if (!error) {
    const { log, stdout } = run('competition-e2e', process.execPath, ['--import', './apps/api/test/networkGuard.js', 'scripts/evidence/competition-e2e.js']);
    await writeFile(resolve(output, 'competition-e2e.log'), log);
    if (!error) try { reports.competition = parseReport(stdout); } catch { error = 'competition report invalid'; }
  }
  const report = { generatedAt: new Date().toISOString(), complete: !error, error, provenance, jobs, reports,
    latencyMs: reports.competition ? latencySummary(reports.competition.latencies.map(row => row.elapsedMs)) : null,
    networkPolicy: 'Node fetch 外部請求被離線護欄阻擋；未執行 Live 或付費指令',
    businessEvidence: { measured: ['本地檢索題組正確率', '合成案件 Backend API 延遲', '導航目標與建置錨點驗證'], notMeasured: ['真人任務完成時間', '客服轉接率下降', '補件率下降', '營收或成本節省'], hypothesesOnly: true },
    limitations: ['非 Gemini 模型準確率', '非正式客戶資料驗收', '未驗證 A 尚未接入的新 UI 操作', 'HTTP 展示不得接受真實敏感文件'] };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(resolve(output, 'README.md'), `# NAVI Demo Evidence\n\n完成：${report.complete}\n\nCommit：${provenance.commit}\n\n工作目錄含未提交變更：${provenance.workingTreeDirty}\n\n完整數據：report.json；每一指令另有 log 及 SHA-256。\n\n${report.limitations.join('\n\n')}\n`);
  console.log(output);
  if (error) process.exitCode = 1;
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await generateEvidencePack();
