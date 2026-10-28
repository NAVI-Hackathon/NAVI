import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeminiProvider } from '../../src/services/gemini.service.js';
import { loadConfig } from '../../src/config/env.js';
import { understandTasks } from '../../src/services/taskService.js';
import { analyzeDocument, parseUpload } from '../../src/services/documentService.js';
import { checkEvidenceConsistency } from '../../src/services/evidenceConsistencyService.js';
import { syntheticPdf } from '../../test/sampleDocuments.js';
import { offlineNetworkStats } from '../../test/networkGuard.js';
import { scoreObservations } from './score.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const suiteDirectory = suite => { assert.ok(['v1', 'v2'].includes(suite)); return new URL(suite === 'v2' ? './v2/' : './', import.meta.url); };
export async function loadHoldout(suite = 'v1') {
  const directory = suiteDirectory(suite);
  const text = await readFile(new URL('cases.jsonl', directory), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory)));
  assert.equal(hash(text), manifest.datasetSha256, 'Ground Truth changed after freeze: create a new dataset version, never silently amend it');
  const cases = text.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(cases.length, manifest.caseCount); assert.equal(new Set(cases.map(row => row.id)).size, cases.length);
  assert.ok(cases.every(row => row.synthetic === true && ['intent', 'document'].includes(row.kind)));
  return { cases, manifest };
}
export async function fixtureBytes(fixture) {
  if (fixture.file) {
    assert.match(fixture.file, /^[a-z][a-z-]*\.(?:pdf|png)$/); assert.match(fixture.sha256, /^[a-f0-9]{64}$/);
    const bytes = await readFile(new URL(`./v2/fixtures/${fixture.file}`, import.meta.url));
    assert.equal(hash(bytes), fixture.sha256, 'Frozen evaluation media changed');
    return { bytes, mimeType: fixture.file.endsWith('.pdf') ? 'application/pdf' : 'image/png', filename: fixture.file };
  }
  if (fixture.lines) return { bytes: syntheticPdf(fixture.lines), mimeType: 'application/pdf', filename: 'holdout-synthetic.pdf' };
  if (fixture.invalidPdf) return { bytes: Buffer.from('%PDF-1.4\ntruncated synthetic test'), mimeType: 'application/pdf', filename: 'invalid.pdf' };
  assert.ok(['blank.png', 'unrelated-landscape.png', 'unrelated-pet.png', 'blurred.png', 'tilted.png', 'multi-page.pdf', 'prompt-injection.pdf'].includes(fixture.existing));
  return { bytes: await readFile(new URL(`../../test/fixtures/reliability/${fixture.existing}`, import.meta.url)),
    mimeType: fixture.existing.endsWith('.pdf') ? 'application/pdf' : 'image/png', filename: fixture.existing };
}
async function parsedUpload(input) {
  const form = new FormData(); form.set('file', new Blob([input.bytes], { type: input.mimeType }), input.filename);
  const request = new Request('http://127.0.0.1/synthetic-test', { method: 'POST', body: form });
  return parseUpload({ is: type => type === 'multipart/form-data', body: Buffer.from(await request.arrayBuffer()), get: key => request.headers.get(key) });
}
export async function runMock(cases, gitSha, suite = 'v1') {
  const outputs = JSON.parse(await readFile(new URL('mock-outputs.json', suiteDirectory(suite))));
  const config = loadConfig({ AI_MODE: 'live', GEMINI_API_KEY: 'synthetic-mock-only', GEMINI_FREE_TIER_CONFIRMED: 'true', AI_MAX_ATTEMPTS: '1' });
  const rows = [];
  for (const entry of cases) {
    const started = performance.now(); let requests = 0; let extraction; let tasks; let errorCode = null;
    let documentStatus; let issues = []; let upload;
    const input = entry.kind === 'document' ? await fixtureBytes(entry.fixture) : null;
    const provider = createGeminiProvider(config, async (_url, init) => {
      requests++;
      const request = JSON.parse(init.body);
      if (input) assert.ok(Buffer.from(request.contents[0].parts[1].inlineData.data, 'base64').equals(input.bytes));
      else assert.equal(request.contents[0].parts[0].text, entry.message);
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(outputs[entry.id]) }] } }] });
    });
    const originalAnalyze = provider.analyzeDocument;
    provider.analyzeDocument = async (...args) => { const data = await originalAnalyze(...args); extraction = { documentType: data.documentType, fields: data.fields }; return data; };
    try {
      if (entry.kind === 'intent') tasks = (await understandTasks(entry.message, { provider, config })).tasks.map(t => ({ serviceType: t.data.serviceType, outcome: t.outcome, extractedData: t.data.extractedData }));
      else {
        upload = await parsedUpload(input);
        const doc = await analyzeDocument(upload, { provider, config });
        issues = [...new Set(checkEvidenceConsistency([...(entry.companion ? [{ id: 'companion', ...entry.companion }] : []), doc], entry.incident).map(i => i.type))];
        documentStatus = issues.length ? 'needs_review' : doc.status;
      }
    } catch (error) { errorCode = error.code ?? 'EVALUATION_FAILURE'; if (entry.kind === 'document') documentStatus = 'rejected'; }
    finally { upload?.bytes.fill(0); }
    rows.push({ id: entry.id, mode: 'mock_transport', provider: 'gemini', model: config.model, gitSha, timestamp: new Date().toISOString(),
      latencyMs: performance.now() - started, requests, tokenUsage: null, fallbackUsed: false, errorCode,
      ...(tasks ? { tasks } : {}), ...(extraction ? { extraction } : {}), ...(documentStatus ? { documentStatus, issues } : {}) });
  }
  return rows;
}
async function main() {
  const args = process.argv.slice(2); let suite = 'v1';
  const suiteIndex = args.indexOf('--suite');
  if (suiteIndex >= 0) { suite = args[suiteIndex + 1]; suiteDirectory(suite); args.splice(suiteIndex, 2); }
  const [mode = '--dry-run', input, ...extra] = args;
  assert.ok(['--dry-run', '--mock', '--score'].includes(mode), 'Live execution is deliberately unavailable; separate approval and current Free Tier verification are required');
  assert.equal(extra.length, 0); assert.ok(mode === '--score' ? input : !input);
  const { cases, manifest } = await loadHoldout(suite);
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
  const fixtures = {};
  for (const row of cases.filter(row => row.kind === 'document')) { const { bytes, mimeType } = await fixtureBytes(row.fixture); fixtures[row.id] = { sha256: hash(bytes), size: bytes.length, mimeType }; }
  if (mode === '--dry-run') {
    console.log(JSON.stringify({ status: 'not_authorized_not_run', gitSha, workingTreeDirty: dirty, manifest, fixtures,
      fullDatasetMaximumRequests: cases.filter(row => !row.fixture?.invalidPdf).length,
      proposedMinimum: { caseIds: manifest.proposedLiveCaseIds, maximumGenerationsIncludingRetries: manifest.proposedLiveCaseIds.length, retryCount: 0, stopOnFirstFailure: true },
      observedProductionLimits: null, requiredBeforeExecution: ['人工核對當前 AI Studio Free Tier、模型與可用配額', '讀取 Production 持久化帳本與 Session 額度；不得用舊帳本日期推算 Google 剩餘量', '另行核准固定請求預算；本程式沒有 Live 開關'], liveGeminiRequests: 0 }, null, 2)); return;
  }
  let rows; let originalReportSha256 = null;
  if (mode === '--mock') rows = await runMock(cases, gitSha, suite);
  else {
    const source = await readFile(resolve(input)); originalReportSha256 = hash(source);
    const imported = JSON.parse(source);
    assert.equal(imported.datasetSha256, manifest.datasetSha256); rows = imported.observations;
  }
  const report = { generatedAt: new Date().toISOString(), scoringGitSha: gitSha, workingTreeDirty: dirty, manifest, fixtures, originalReportSha256,
    interpretation: mode === '--mock' ? 'Mock outputs are authored fixtures, not model predictions or AI accuracy.' : 'Captured observations only; provenance must also be checked against original transport records. Never pool with mock outcomes.',
    metrics: scoreObservations(cases, rows), network: offlineNetworkStats(), liveGenerationsByThisTool: 0, paidApiCalls: 0 };
  assert.equal(report.network.blockedExternalAttempts, 0);
  const directory = fileURLToPath(new URL('../../../../artifacts/holdout/', import.meta.url));
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${mode.slice(2)}-${Date.now()}.json`);
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: path, ...report }, null, 2));
  // A completed measurement may contain failures; report them instead of rewriting Ground Truth.
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
