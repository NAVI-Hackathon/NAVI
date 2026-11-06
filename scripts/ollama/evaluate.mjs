import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { loadConfig } from '../../apps/api/src/config/env.js';
import { ollamaConfig, OLLAMA_TEXT_MODEL, OLLAMA_VISION_MODELS } from '../../apps/api/src/config/ollama.js';
import { createOllamaProvider } from '../../apps/api/src/ai/ollamaProvider.js';
import { createOllamaTransport } from '../../apps/api/src/ai/ollamaTransport.js';
import { understandTasks } from '../../apps/api/src/services/taskService.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const suite = new URL('../../apps/api/eval/holdout/v2/', import.meta.url);
const dataset = readFileSync(new URL('cases.jsonl', suite));
const cases = new Map(dataset.toString().trim().split('\n').map(line => {
  const entry = JSON.parse(line);
  return [entry.id, entry];
}));
const text = ['I21', 'I22', 'I23', 'I24', 'I25', 'I29', 'I33', 'I36'];
const vision = ['D21', 'D23', 'D24', 'D25', 'D26', 'D30', 'D32'];
const [mode = '--dry-run', suiteName = 'smoke', ack, ...extra] = process.argv.slice(2);
if (!['--dry-run', '--prepare', '--metadata', '--run'].includes(mode) || !['smoke', 'text', 'vision-baseline', 'vision'].includes(suiteName) || extra.length ||
    (mode === '--run' ? ack !== '--confirm-synthetic' : ack !== undefined)) {
  throw new Error('Usage: node scripts/ollama/evaluate.mjs [--dry-run|--prepare|--metadata|--run] [smoke|text|vision-baseline|vision] [--confirm-synthetic only for --run]');
}
const jobs = suiteName === 'text' ? text.map(id => ({ id, model: OLLAMA_TEXT_MODEL, operation: 'tasks' }))
  : suiteName === 'vision' ? OLLAMA_VISION_MODELS.flatMap(model => vision.map(id => ({ id, model, operation: 'document' })))
  : suiteName === 'vision-baseline' ? [{ id: 'D32', model: OLLAMA_VISION_MODELS[0], operation: 'document' }]
  : [{ id: 'I21', model: OLLAMA_TEXT_MODEL, operation: 'intent' }, { id: 'I25', model: OLLAMA_TEXT_MODEL, operation: 'tasks' },
    ...OLLAMA_VISION_MODELS.map(model => ({ id: 'D32', model, operation: 'document' }))];
const git = args => execFileSync('git', args, { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' }).trim();
const evidence = { timestamp: new Date().toISOString(), gitSha: git(['rev-parse', 'HEAD']), trackedChanges: Boolean(git(['status', '--porcelain', '-uno'])),
  datasetSha256: sha256(dataset), dataset: 'NAVI holdout v2 (frozen developer fixtures)', mode, suite: suiteName, plannedRequests: jobs.length, generationAttempts: 0 };

function renderSyntheticPdf(bytes) {
  const directory = mkdtempSync(join(tmpdir(), 'navi-ollama-fixture-'));
  try {
    const output = join(directory, 'page');
    execFileSync('pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-scale-to', '1200', '-png', '-', output],
      { input: bytes, timeout: 15000, maxBuffer: 64 * 1024, stdio: ['pipe', 'ignore', 'pipe'] });
    return readFileSync(output + '.png');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function prepareMedia() {
  const media = new Map();
  for (const { id, operation } of jobs) {
    if (operation !== 'document' || media.has(id)) continue;
    const entry = cases.get(id);
    const fixture = entry.fixture;
    if (!entry.synthetic || !/^[a-z-]+\.(?:pdf|png)$/.test(fixture.file)) throw new Error('Unexpected fixture');
    const file = new URL('fixtures/' + fixture.file, suite);
    const original = readFileSync(file);
    if (sha256(original) !== fixture.sha256) throw new Error(`Frozen fixture fingerprint mismatch: ${id}`);
    // Rasterize only known, checked-in fixtures. The sandbox API never renders uploaded PDFs.
    const bytes = fixture.file.endsWith('.pdf') ? renderSyntheticPdf(original) : original;
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`Expected prepared PNG: ${id}`);
    media.set(id, { bytes, inputSha256: sha256(bytes), sourceSha256: fixture.sha256 });
  }
  return media;
}

function publicMedia(media) {
  return [...media].map(([id, { bytes, ...hashes }]) => ({ id, size: bytes.length, ...hashes }));
}
const base = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const models = [...new Set(jobs.map(job => job.model))];
async function metadata(send) {
  async function read(path, payload) {
    const response = await send(path, { signal: AbortSignal.timeout(5000), payload });
    if (response.status !== 200) throw new Error(`Metadata unavailable: ${path}, HTTP ${response.status}`);
    return JSON.parse(response.body);
  }
  const [{ version }, { models: installed }] = await Promise.all([read('/api/version'), read('/api/tags')]);
  if (typeof version !== 'string' || !Array.isArray(installed)) throw new Error('Invalid Ollama metadata');
  const result = [];
  for (const model of models) {
    const entry = installed.find(entry => entry.name === model || entry.model === model);
    if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(entry?.digest ?? '')) throw new Error(`Required model tag or digest missing: ${model}`);
    const { capabilities } = await read('/api/show', { model });
    const expected = model === OLLAMA_TEXT_MODEL ? ['completion'] : ['completion', 'vision'];
    if (!Array.isArray(capabilities) || expected.some(capability => !capabilities.includes(capability))) throw new Error(`Model capabilities do not match: ${model}`);
    result.push({ model, digest: entry.digest, capabilities });
  }
  return { version, models: result };
}

function exactTasks(actual, expected) {
  return actual?.length === expected.length && actual.every(({ serviceType, outcome }, i) => serviceType === expected[i].serviceType && (outcome === undefined || outcome === expected[i].outcome));
}
function scores(results) {
  const ratio = (n, d) => d ? n / d : null;
  return models.map(model => {
    const planned = results.filter(result => result.model === model);
    const attempted = planned.filter(result => result.status !== 'not_run');
    const completed = attempted.filter(result => result.actual);
    const durations = attempted.map(result => result.latencyMs).sort((a, b) => a - b);
    const percentile = p => durations[Math.ceil(p * durations.length) - 1] ?? null;
    const summary = { model, planned: planned.length, attempted: attempted.length, completed: completed.length,
      errors: attempted.length - completed.length, caseCorrect: completed.filter(result => result.correct).length,
      latencyMs: { p50: percentile(0.5), p95: percentile(0.95) } };
    if (model === OLLAMA_TEXT_MODEL) return summary;
    let truePositive = 0, inventedOrWrong = 0, missingOrWrong = 0, omitted = 0;
    for (const result of completed) {
      const actual = result.actual.fields;
      const expected = result.expected.fields;
      for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
        const a = actual[key] ?? null;
        const e = expected[key] ?? null;
        if (a !== null && a === e) truePositive++;
        if (a !== null && a !== e) inventedOrWrong++;
        if (e !== null && a !== e) missingOrWrong++;
        if (e !== null && a === null) omitted++;
      }
    }
    return { ...summary, negativeCasesCompleted: completed.filter(result => result.expected.documentType === 'unknown').length,
      negativeCasesMisclassified: completed.filter(result => result.expected.documentType === 'unknown' && result.actual.documentType !== 'unknown').length,
      documentTypeCorrect: completed.filter(result => result.actual.documentType === result.expected.documentType).length,
      fields: { truePositive, inventedOrWrong, missingOrWrong, omitted, omissionRate: ratio(omitted, truePositive + missingOrWrong),
        precision: ratio(truePositive, truePositive + inventedOrWrong), recall: ratio(truePositive, truePositive + missingOrWrong),
        f1: ratio(2 * truePositive, 2 * truePositive + inventedOrWrong + missingOrWrong) } };
  });
}

async function main() {
  if (mode === '--dry-run') return { ...evidence, jobs };
  if (mode === '--prepare') return { ...evidence, fixtures: publicMedia(prepareMedia()), jobs };
  if (process.env.CI && !['false', '0'].includes(process.env.CI.toLowerCase())) throw new Error('Ollama metadata and generation are disabled in CI');
  const connection = {
    OLLAMA_BASE_URL: base,
    OLLAMA_TLS_CA_FILE: process.env.OLLAMA_TLS_CA_FILE,
    OLLAMA_TLS_CERT_FILE: process.env.OLLAMA_TLS_CERT_FILE,
    OLLAMA_TLS_KEY_FILE: process.env.OLLAMA_TLS_KEY_FILE,
    OLLAMA_TLS_SERVER_NAME: process.env.OLLAMA_TLS_SERVER_NAME,
  };
  const transportConfig = ollamaConfig(connection);
  const send = createOllamaTransport(base, transportConfig.ollamaTls, { requireBroker: mode === '--run' });
  const inventory = await metadata(send);
  if (mode === '--metadata') return { ...evidence, inventory };
  const media = prepareMedia();
  const results = [];
  const counts = new Map();
  const providers = new Map(models.map(model => {
    const config = loadConfig({
      ...connection, AI_MODE: 'live', AI_PROVIDER: 'ollama',
      OLLAMA_VISION_MODEL: model === OLLAMA_TEXT_MODEL ? '' : model,
      OLLAMA_TIMEOUT_MS: '75000', NAVI_TEST_SESSION_TOKEN: 'isolated-offline-evaluation-internal',
      LIVE_AI_REQUEST_LIMIT: String(jobs.filter(job => job.model === model).length),
      AI_SYNTHETIC_DOCUMENT_SHA256: [...media.values()].map(value => value.inputSha256).join(','),
    });
    return [model, { config, provider: createOllamaProvider(config, (path, options) => {
      evidence.generationAttempts++;
      counts.set(model, (counts.get(model) ?? 0) + 1);
      return send(path, options);
    }) }];
  }));
  let stopped = false;
  for (const job of jobs) {
    const { groundTruth, message } = cases.get(job.id);
    const expected = job.operation === 'document' ? { documentType: groundTruth.documentType, fields: groundTruth.fields } : groundTruth.tasks;
    const result = { ...job, expected, status: 'not_run' };
    results.push(result);
    if (stopped) continue;
    const { provider, config } = providers.get(job.model);
    const started = performance.now();
    result.startedAt = new Date().toISOString();
    const before = counts.get(job.model) ?? 0;
    try {
      if (job.operation === 'intent') {
        const { serviceType } = await provider.understandIntent(message);
        result.actual = [{ serviceType }];
      } else if (job.operation === 'tasks') {
        const { tasks } = await understandTasks(message, { provider, config });
        result.actual = tasks.map(({ data, outcome }) => ({ serviceType: data.serviceType, outcome }));
      } else {
        result.actual = await provider.analyzeDocument({ mimeType: 'image/png', bytes: media.get(job.id).bytes });
      }
      result.correct = job.operation === 'document'
        ? result.actual.documentType === expected.documentType &&
          [...new Set([...Object.keys(expected.fields), ...Object.keys(result.actual.fields)])].every(key => (result.actual.fields[key] ?? null) === (expected.fields[key] ?? null))
        : exactTasks(result.actual, expected);
      result.status = 'completed';
    } catch (error) {
      result.status = 'error';
      result.errorCode = error.code ?? 'EVALUATION_ERROR';
      if (suiteName === 'smoke' || result.errorCode !== 'AI_RESPONSE_INVALID') stopped = true;
    }
    result.latencyMs = Math.round(performance.now() - started);
    result.attempts = (counts.get(job.model) ?? 0) - before;
    const modelMetadata = provider.getDebugMetadata()[job.operation];
    result.usage = modelMetadata?.usage ?? null;
    result.modelTiming = modelMetadata?.modelTiming ?? null;
  }
  if (results.some(result => result.status !== 'completed' || !result.correct)) process.exitCode = 1;
  return { ...evidence, inventory, fixtures: publicMedia(media), scores: scores(results), results };
}
try { console.log(JSON.stringify(await main(), null, 2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
