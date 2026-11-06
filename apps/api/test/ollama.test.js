import { ApiError } from '../src/middleware/errorHandler.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createAIProvider } from '../src/ai/provider.js';
import { createOllamaProvider } from '../src/ai/ollamaProvider.js';
import { createOllamaTransport, ollamaOrigin } from '../src/ai/ollamaTransport.js';
import { prepareOllamaDocument } from '../src/ai/ollamaDocumentInput.js';
import { UnderstandingSchema } from '../../../shared/intelligence.js';
import { analyzeDocument } from '../src/services/documentService.js';
import { answerKnowledge } from '../src/services/knowledgeAnswerService.js';
import { understandTasks } from '../src/services/taskService.js';
import { createJourneyService } from '../src/services/journeyService.js';
import { InMemoryJourneyRepository } from '../src/repositories/inMemoryJourneyRepository.js';
import { offlineNetworkStats } from './networkGuard.js';

const image = readFileSync(new URL('../eval/holdout/v2/fixtures/bank.png', import.meta.url));
const sha = createHash('sha256').update(image).digest('hex');
const env = {
  AI_MODE: 'live', AI_PROVIDER: 'ollama', NAVI_TEST_SESSION_TOKEN: 'offline-test-token'.repeat(3),
  OLLAMA_VISION_MODEL: 'qwen3.5:4b-q4_K_M', AI_SYNTHETIC_DOCUMENT_SHA256: sha,
};
const config = loadConfig(env);
const upload = { mimeType: 'image/png', bytes: image, size: image.length, filename: 'synthetic.png', documentType: 'bank_passbook' };
const message = '我住院五天，要準備理賠。';
const intent = {
  intent: 'service_request', serviceType: 'hospitalization_claim', confidence: 0.95, summary: message,
  extractedData: { origin: null, destination: null, delayMinutes: null, incidentDate: null, reportedInpatientDays: 5 },
};
const address = { ...intent, serviceType: 'policy_change', summary: '我要改地址', extractedData: { ...intent.extractedData, reportedInpatientDays: null } };
const bank = { documentType: 'bank_passbook', confidence: 0.95, fields: {
  passengerName: null, flightNumber: null, origin: null, destination: null, departureDate: null, actualDepartureDate: null,
  scheduledDeparture: null, actualDeparture: null, accountHolder: 'NAVI EVAL PERSON A', bankName: 'NAVI EVALUATION BANK', accountLast4: '0627',
} };
const knowledge = { answer: '這是測試原文。', sources: [{ id: 'fixture:1', content: '這是測試原文。' }], sourceIds: ['fixture:1'] };
const grounded = { answer: knowledge.answer, supported: true, confidence: 0.9, sourceIds: knowledge.sourceIds };
const envelope = (model, raw, overrides = {}) => JSON.stringify({
  model, done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(raw) }, prompt_eval_count: 120, eval_count: 12, ...overrides,
});
const response = (payload, raw, overrides) => ({ status: 200, body: envelope(payload.model, raw, overrides) });
const mock = (raw, cfg = config) => createOllamaProvider(cfg, async (_, { payload }) => response(payload, raw));

async function loopback(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('provider selection is opt-in, restricted, and leaves Demo and production defaults in place', () => {
  assert.equal(loadConfig({}).aiProvider, 'gemini');
  assert.equal(createAIProvider(loadConfig({ AI_MODE: 'live' })).backend, undefined);
  assert.equal(createAIProvider(loadConfig(env)).backend, 'ollama');
  assert.equal(createAIProvider(loadConfig({ ...env, AI_MODE: 'demo' })).mode, 'demo');
  assert.equal(createAIProvider(loadConfig({ ...env, AI_MODE: 'unavailable' })).mode, 'unavailable');
  assert.equal(createAIProvider(loadConfig({ ...env, CI: 'true' })).mode, 'unavailable');
  assert.equal(loadConfig({ ...env, GEMINI_API_KEY: 'must-not-be-used' }).apiKey, '');
  for (const overrides of [{ NODE_ENV: 'production' }, { NAVI_PRODUCT_MODE: 'true' }, { AI_PUBLIC_SYNTHETIC: 'true' }, { AI_MAX_ATTEMPTS: '2' },
    { HOST: '0.0.0.0' }, { TRUST_PROXY_LOOPBACK: 'true' }, { ALLOW_PAID_AI: 'true' }, { NAVI_TEST_SESSION_TOKEN: 'short' }, { OLLAMA_TEXT_MODEL: 'unapproved' }]) {
    assert.throws(() => loadConfig({ ...env, ...overrides }));
  }
  assert.equal(ollamaOrigin('https://127.0.0.1:11434', { requireTLS: true }), 'https://127.0.0.1:11434');
  assert.throws(() => ollamaOrigin('http://127.0.0.1:11434', { requireTLS: true }));
  for (const url of ['http://localhost:11434', 'http://127.1:11434', 'http://127.0.0.1:11434/api', 'http://127.0.0.1:11434@other.test', 'http://127.0.0.1:99999']) assert.throws(() => ollamaOrigin(url));
});

test('real loopback HTTP sends a structured chat payload and validates intent and model metadata', async t => {
  let captured;
  const base = await loopback(t, createServer(async (req, res) => {
    assert.equal(req.url, '/api/chat');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.authorization, undefined);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    captured = JSON.parse(Buffer.concat(chunks));
    res.end(envelope(captured.model, intent));
  }));
  const provider = createOllamaProvider(config, createOllamaTransport(base));
  assert.equal((await provider.understandIntent(message)).serviceType, 'hospitalization_claim');
  assert.equal(captured.stream, false);
  assert.equal(captured.think, false);
  assert.equal(captured.keep_alive, 0);
  assert.deepEqual(captured.format.properties.serviceType.enum.includes('hospitalization_claim'), true);
  assert.deepEqual(captured.messages.map(m => m.role), ['system', 'user']);
  assert.equal(captured.messages[1].content, message);
  const metadata = provider.getDebugMetadata().intent;
  assert.equal(metadata.model, config.ollamaModel);
  assert.equal(metadata.schemaValid, true);
  assert.deepEqual(metadata.usage, { inputTokens: 120, outputTokens: 12 });
  assert.ok(!JSON.stringify(metadata).includes(message));
});

test('multiple tasks preserve original spans and cannot omit or invent tasks', async () => {
  const combined = '我要改地址，另外' + message;
  const taskData = { tasks: [{ input: '我要改地址', data: address }, { input: message, data: intent }] };
  const result = await understandTasks(combined, { config, provider: mock(taskData) });
  assert.deepEqual(result.tasks.map(task => task.data.serviceType), ['policy_change', 'hospitalization_claim']);
  assert.equal(result.isMock, false);
  for (const tasks of [[taskData.tasks[0]], [{ input: '捏造的任務', data: intent }]]) {
    const provider = mock({ tasks });
    await assert.rejects(understandTasks(combined, { config, provider }), { code: 'AI_RESPONSE_INVALID' });
    assert.equal(provider.getRequestBudget().used, 1);
  }
});

test('conversation, knowledge and handoff reuse the existing structured schemas', async () => {
  const tasks = [{ input: message, data: intent }];
  const provider = createOllamaProvider(config, async (_, { payload }) => {
    if (payload.format.properties.tasks) return response(payload, { tasks, answer: grounded });
    if (payload.format.properties.factIds) return response(payload, { factIds: ['issue'] });
    return response(payload, grounded);
  });
  assert.deepEqual((await provider.converse(message, { tasks: [] }, knowledge.sources)).tasks, tasks);
  assert.deepEqual(await provider.answerKnowledge(message, knowledge), grounded);
  assert.deepEqual(await provider.summarizeHandoff([{ id: 'issue', text: '合成事實' }]), { factIds: ['issue'] });
  await assert.rejects(mock({ tasks, answer: { ...grounded, sourceIds: ['fake'] } }).converse(message, {}, knowledge.sources), { code: 'AI_RESPONSE_INVALID' });
  await assert.rejects(mock({ ...grounded, answer: '沒有依據的規則' }).answerKnowledge(message, knowledge), { code: 'AI_RESPONSE_INVALID' });
});

test('invalid JSON, incomplete replies, tool calls, wrong model and illegal business fields are rejected', async () => {
  for (const makeResponse of [
    () => ({ status: 200, body: '<invalid>' }),
    payload => response(payload, intent, { message: { role: 'assistant', content: 'oops' } }),
    payload => response(payload, intent, { done_reason: 'length' }),
    payload => response(payload, intent, { done: false }),
    payload => response(payload, intent, { model: 'unapproved' }),
    payload => response(payload, { ...intent, readiness: 100 }),
    payload => response(payload, intent, { message: { role: 'assistant', content: JSON.stringify(intent), tool_calls: [{ function: { name: 'update_journey' } }] } }),
  ]) {
    const provider = createOllamaProvider(config, async (_, { payload }) => makeResponse(payload));
    await assert.rejects(provider.understandIntent(message), { code: 'AI_RESPONSE_INVALID' });
    assert.equal(provider.getRequestBudget().used, 1);
    assert.equal(provider.getDebugMetadata().intent.schemaValid, false);
  }
});

test('abort cancels queued and dispatched work, and timeout fails even on a stuck transport', async () => {
  const started = Promise.withResolvers();
  let activeSignal;
  const provider = createOllamaProvider({ ...config, timeoutMs: 1000 }, (_, { signal }) => {
    activeSignal = signal;
    started.resolve();
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const running = new AbortController();
  const first = provider.understandIntent(message, running.signal);
  await started.promise;
  const waiting = new AbortController();
  const second = provider.understandIntent(message, waiting.signal);
  waiting.abort();
  await assert.rejects(second, { code: 'REQUEST_CANCELLED' });
  running.abort();
  await assert.rejects(first, { code: 'REQUEST_CANCELLED' });
  assert.equal(activeSignal.aborted, true);
  assert.equal(provider.getRequestBudget().used, 1);

  const stuck = createOllamaProvider({ ...config, timeoutMs: 25 }, () => new Promise(() => {}));
  const keepAlive = setTimeout(() => {}, 500);
  try { await assert.rejects(stuck.understandIntent(message), { code: 'AI_TIMEOUT' }); }
  finally { clearTimeout(keepAlive); }
  assert.equal(stuck.getRequestBudget().used, 1);
});

test('bounded queue rejects surplus work and exhausted budget before sending', async () => {
  const complete = Promise.withResolvers();
  let calls = 0;
  const provider = createOllamaProvider({ ...config, queueLimit: 1, liveRequestLimit: 1 }, async (_, { payload }) => {
    calls++;
    await complete.promise;
    return response(payload, intent);
  });
  const first = provider.understandIntent(message);
  const second = provider.understandIntent(message);
  const rejected = assert.rejects(second, { code: 'AI_REQUEST_BUDGET_REACHED' });
  try { await assert.rejects(provider.understandIntent(message), { code: 'AI_BUSY' }); }
  finally { complete.resolve(); }
  await first;
  await rejected;
  assert.equal(calls, 1);
});

test('closed sockets, HTTP errors, oversized responses and redirects fail without retries or fixture fallback', async t => {
  let requests = 0;
  const base = await loopback(t, createServer((req, res) => {
    switch (++requests) {
      case 1: req.socket.destroy(); break;
      case 2: res.writeHead(302, { Location: 'https://example.invalid/' }).end(); break;
      case 3: res.writeHead(503).end('internal details'); break;
      case 4: res.writeHead(429).end(); break;
      default: res.end('x'.repeat(129 * 1024));
    }
  }));
  const provider = createOllamaProvider(config, createOllamaTransport(base));
  for (const [i, code] of ['AI_PROVIDER_ERROR', 'AI_PROVIDER_ERROR', 'AI_PROVIDER_ERROR', 'AI_RATE_LIMITED', 'AI_PROVIDER_ERROR'].entries()) {
    await assert.rejects(provider.understandIntent(message), { code });
    assert.equal(requests, i + 1);
  }
  assert.equal(offlineNetworkStats().blockedExternalAttempts, 0);
  assert.equal(provider.getDebugMetadata().intent.fallbackUsed, false);
});

test('knowledge uses retrieved evidence during disconnect and records the fallback', async () => {
  const provider = createOllamaProvider(config, async () => { throw new Error('socket closed'); });
  const result = await answerKnowledge('我要變更通訊地址', { provider, config });
  assert.equal(result.answerMode, 'retrieval_template');
  assert.ok(result.sources.length > 0);
  assert.equal(provider.getRequestBudget().used, 1);
  assert.equal(provider.getDebugMetadata().knowledge.fallbackUsed, true);
});

test('vision sends actual approved PNG bytes, and valid output still cannot increase readiness', async () => {
  const provider = createOllamaProvider(config, async (_, { payload }) => {
    if (payload.model === config.ollamaModel) return response(payload, intent);
    assert.equal(payload.model, config.ollamaVisionModel);
    assert.deepEqual(Buffer.from(payload.messages[1].images[0], 'base64'), image);
    return response(payload, bank);
  });
  const service = createJourneyService({ repository: new InMemoryJourneyRepository(), provider, config });
  const journey = await service.create({ message });
  const added = await service.addDocument(journey.id, upload);
  assert.equal(added.document.fields.accountLast4, '0627');
  assert.equal(added.document.status, 'needs_review');
  assert.equal(added.document.requiresRevalidation, true);
  assert.equal(added.document.isMock, false);
  assert.equal(added.journey.readiness, journey.readiness);
  assert.deepEqual(added.document.matchedRequirements, []);
  await assert.rejects(provider.analyzeDocument({ ...upload, bytes: Buffer.concat([image, Buffer.from('extra')]), sha256: sha }), { code: 'DOCUMENT_NOT_SYNTHETIC' });
  await assert.rejects(provider.analyzeDocument({ ...upload, mimeType: 'application/pdf' }), { code: 'DOCUMENT_INTELLIGENCE_NOT_AVAILABLE' });
  await assert.rejects(analyzeDocument(upload, { provider: mock({ ...bank, documentType: 'unknown' }), config }), { code: 'DOCUMENT_UNRECOGNIZED' });
  await assert.rejects(analyzeDocument(upload, { provider: mock({ ...bank, status: 'verified' }), config }), { code: 'AI_RESPONSE_INVALID' });
});

test('sandbox API requires an operator cookie and exposes truthful provider status without changing shared contracts', async t => {
  const provider = mock(intent);
  // The mock transport represents an online model for this route test; the separate health check verifies offline behavior.
  provider.checkHealth = async () => true;
  const app = createApp(config, provider);
  const base = await loopback(t, createServer(app));
  const headers = { Origin: config.origins[0], 'Content-Type': 'application/json' };
  const post = (path, body) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await post('/api/analyze-intent', { message })).status, 403);
  assert.equal(provider.getRequestBudget().used, 0);
  const session = await post('/api/test-sessions', { syntheticOnly: true, token: env.NAVI_TEST_SESSION_TOKEN });
  assert.equal(session.status, 201);
  assert.match((await session.json()).disclosure, /Ollama/);
  headers.Cookie = session.headers.get('set-cookie').split(';')[0];
  const status = await fetch(base + '/api/ai/status', { headers });
  assert.equal(status.headers.get('X-NAVI-AI-Mode'), 'live');
  assert.equal((await status.json()).backend, 'ollama');
  assert.equal((await post('/api/intelligence/understand', { message })).status, 503);
  const analysis = await post('/api/analyze-intent', { message });
  assert.equal(analysis.status, 200);
  assert.equal((await analysis.json()).serviceType, 'hospitalization_claim');
  assert.equal(provider.getRequestBudget().used, 1);
});

test('evaluation is offline by default, checks vision capabilities and preserves failed and unrun cases', async t => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const script = new URL('../../../scripts/ollama/evaluate.mjs', import.meta.url);
  const run = (base, ...args) => promisify(execFile)(process.execPath, [decodeURIComponent(script.pathname), ...args], {
    env: { ...process.env, OLLAMA_BASE_URL: base, CI: 'false' }, timeout: 10000,
  });
  let chatCount = 0;
  let visionAvailable = false;
  let offline = false;
  const tags = [config.ollamaModel, 'qwen3.5:4b-q4_K_M', 'qwen3-vl:4b-instruct'];
  const base = await loopback(t, createServer(async (req, res) => {
    if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.0.0-mock' }));
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: tags.map(name => ({ name, digest: 'a'.repeat(64) })) }));
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks));
    if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: ['completion', ...(visionAvailable && payload.model !== tags[0] ? ['vision'] : [])] }));
    assert.equal(req.url, '/api/chat');
    chatCount++;
    if (offline && chatCount === 2) return res.writeHead(503).end();
    if (payload.format.properties.tasks) return res.end(envelope(payload.model, { tasks: [
      { input: '我想換通訊地址', data: address }, { input: '我要開始準備住院理賠。', data: intent },
    ] }));
    return res.end(envelope(payload.model, payload.model === tags[0] ? intent : bank));
  }));
  const dry = JSON.parse((await run('http://not-loopback.invalid', '--dry-run', 'vision')).stdout);
  assert.equal(dry.plannedRequests, 14);
  assert.equal(dry.generationAttempts, 0);
  await assert.rejects(run(base, '--run', 'smoke'), /Usage/);
  await assert.rejects(run(base, '--metadata', 'smoke'), /capabilities do not match/);
  assert.equal(chatCount, 0);
  visionAvailable = true;
  const inventory = JSON.parse((await run(base, '--metadata', 'smoke')).stdout);
  assert.equal(inventory.inventory.models.length, 3);
  assert.equal(chatCount, 0);
  offline = true;
  await assert.rejects(run(base, '--run', 'smoke', '--confirm-synthetic'), error => {
    const report = JSON.parse(error.stdout);
    assert.equal(report.generationAttempts, 2);
    assert.deepEqual(report.results.map(result => result.status), ['completed', 'error', 'not_run', 'not_run']);
    assert.equal(report.results[1].errorCode, 'AI_PROVIDER_ERROR');
    return true;
  });
  chatCount = 0;
  offline = false;
  const report = JSON.parse((await run(base, '--run', 'smoke', '--confirm-synthetic')).stdout);
  assert.equal(report.generationAttempts, 4);
  assert.equal(chatCount, 4);
  assert.deepEqual(report.scores.slice(1).map(score => score.fields.f1), [1, 1]);
});

test('production Ollama selects local model without Gemini key, and refuses insecure transport', async () => {
  const tls = {
    OLLAMA_BASE_URL: 'https://127.0.0.1:21144', OLLAMA_TLS_CA_FILE: '/private/ca.pem',
    OLLAMA_TLS_CERT_FILE: '/private/client.pem', OLLAMA_TLS_KEY_FILE: '/private/client.key',
    OLLAMA_TLS_SERVER_NAME: 'navi-gateway.internal',
  };
  const product = loadConfig({ ...env, ...tls, NODE_ENV: 'production', NAVI_PRODUCT_MODE: 'true',
    NAVI_DATA_ENCRYPTION_KEY: 'only-an-isolated-test-marker', GEMINI_API_KEY: 'never-used' });
  assert.equal(product.aiProvider, 'ollama');
  assert.equal(product.apiKey, '');
  assert.equal(product.model, product.ollamaModel);
  assert.equal(product.modelPolicies[0].id, product.ollamaModel);
  assert.equal(product.modelPolicies[0].documentation, 'https://docs.ollama.com/api/chat');
  let charged = 0;
  let sent = 0;
  product.store = { async charge(day, kind, limit) {
    assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(kind, 'requests');
    assert.equal(limit, product.dailyLimit);
    if (charged++) throw new ApiError('AI_DAILY_LIMIT_REACHED', 'test only', 429, false);
  } };
  const provider = createOllamaProvider(product, async (path, { payload }) => {
    if (path === '/api/version') return { status: 200, body: JSON.stringify({ version: 'mock' }) };
    sent++;
    return response(payload, intent);
  });
  assert.equal(provider.backend, 'ollama');
  assert.equal(await provider.checkHealth(), true);
  assert.equal((await provider.understandIntent(message)).serviceType, 'hospitalization_claim');
  assert.equal(provider.getDebugMetadata().intent.fallbackUsed, false);
  await assert.rejects(provider.understandIntent(message), { code: 'AI_DAILY_LIMIT_REACHED' });
  assert.equal(sent, 1);
  assert.deepEqual(UnderstandingSchema.shape.meta.shape.source.safeParse('ollama').success, true);
  for (const override of [{ OLLAMA_BASE_URL: 'http://127.0.0.1:21144' },
    { OLLAMA_TLS_KEY_FILE: '' }, { OLLAMA_TLS_SERVER_NAME: '' },
    { OLLAMA_BASE_URL: 'https://example.invalid:443' }, { ALLOW_PAID_AI: 'true' }]) {
    assert.throws(() => loadConfig({ ...env, ...tls, ...override, NODE_ENV: 'production',
      NAVI_PRODUCT_MODE: 'true', NAVI_DATA_ENCRYPTION_KEY: 'test-only' }));
  }
});

test('synthetic document protection requires known bytes, never filename or claimed hash', async () => {
  const allow = new Set([sha]);
  const prepared = await prepareOllamaDocument(upload, allow);
  assert.equal(prepared.kind, 'image');
  assert.equal(prepared.media.length, 1);
  assert.deepEqual(prepared.media[0], image);
  const fakePdf = Buffer.from('%PDF-1.7\\n%%EOF\\n');
  await assert.rejects(prepareOllamaDocument({
    bytes: fakePdf, mimeType: 'application/pdf', filename: 'synthetic.pdf', sha256: sha,
  }, allow), { code: 'DOCUMENT_NOT_SYNTHETIC' });
  const tooLarge = Buffer.alloc(2 * 1024 * 1024 + 1);
  tooLarge.set(image.subarray(0, Math.min(image.length, 24)));
  await assert.rejects(prepareOllamaDocument({ bytes: tooLarge, mimeType: 'image/png' },
    new Set([createHash('sha256').update(tooLarge).digest('hex')])), { code: 'DOCUMENT_INTELLIGENCE_NOT_AVAILABLE' });
});
