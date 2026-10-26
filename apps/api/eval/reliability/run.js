import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createGeminiProvider } from '../../src/services/gemini.service.js';
import { loadConfig } from '../../src/config/env.js';
import { understandTasks } from '../../src/services/taskService.js';
import { offlineNetworkStats } from '../../test/networkGuard.js';
import { latencySummary } from '../../../../scripts/evidence-pack.js';

const dataset = process.argv[2] ? resolve(process.argv[2]) : new URL('./cases.jsonl', import.meta.url);
const datasetText = await readFile(dataset, 'utf8');
const cases = datasetText.trim().split('\n').map(line => JSON.parse(line));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const workingTreeDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
const diff = execFileSync('git', ['diff', 'HEAD'], { encoding: 'utf8' });
const config = loadConfig({ AI_MODE: 'live', GEMINI_API_KEY: 'synthetic-mock-key', GEMINI_FREE_TIER_CONFIRMED: 'true', AI_MAX_ATTEMPTS: '1' });
const rows = [];
for (const item of cases) {
  let requests = 0; const started = performance.now(); let actual; let error;
  const provider = createGeminiProvider(config, async (_url, init) => {
    requests++; assert.equal(JSON.parse(init.body).contents[0].parts[0].text, item.message);
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(item.mockOutput) }] } }] });
  });
  try {
    const output = await understandTasks(item.message, { config, provider });
    actual = { serviceTypes: output.tasks.map(t => t.data.serviceType), outcomes: output.tasks.map(t => t.outcome) };
    assert.deepEqual(actual, item.groundTruth); assert.equal(output.isMock, false); assert.equal(requests, 1);
  } catch (failure) { error = failure.code ?? failure.message; }
  rows.push({ id: item.id, category: item.category, groundTruth: item.groundTruth, actual, pass: !error, error, responseTimeMs: performance.now() - started, mockTransportRequests: requests, fallbackUsed: false });
}
const network = offlineNetworkStats(); assert.equal(network.blockedExternalAttempts, 0);
console.log(JSON.stringify({ scope: 'mock_transport_schema_and_deterministic_guards', commit, workingTreeDirty, trackedDiffSha256: createHash('sha256').update(diff).digest('hex'), dataset: String(dataset), datasetSha256: createHash('sha256').update(datasetText).digest('hex'), independentHeldOut: false, fixtureProvenance: 'Human-authored fixed outputs; not predictions from Gemini', generatedAt: new Date().toISOString(),
  model: config.model, providerInterface: 'gemini_with_injected_mock_transport', cases: rows.length, passed: rows.filter(r => r.pass).length,
  mockValidationPassRate: rows.filter(r => r.pass).length / rows.length, latencyMs: latencySummary(rows.map(r => r.responseTimeMs)),
  liveEvaluation: { status: 'not_run', requests: 0, accuracy: null, reason: '本輪無新的 Free Tier 人工確認與 Live 請求授權。' }, network, rows }, null, 2));
if (rows.some(row => !row.pass)) process.exitCode = 1;
