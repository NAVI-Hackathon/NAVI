import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDemoProvider } from '../src/ai/demoProvider.js';
import { createAIRequestBudget } from '../src/ai/costGuard.js';
import { normalizeIntent } from '../src/schemas/intent.schema.js';
import { createJourneyService } from '../src/services/journeyService.js';
import { understandIntent } from '../src/services/intent.service.js';
import { InMemoryJourneyRepository } from '../src/repositories/inMemoryJourneyRepository.js';
import { UnderstandingSchema } from '../../../shared/intelligence.js';
import { ServiceJourneySchema } from '../../../shared/journey.js';
import { createSession, toSnapshot, applySampleDocument, confirmSession, removeDocument } from '../../web/src/services/journeyEngine.js';
import { DEMO_STORY } from '../../web/src/mocks/hospitalClaim.js';
import { samplePdf } from './sampleDocuments.js';

const config = loadConfig({ AI_MODE: 'demo' });
const facts = { origin: null, destination: null, delayMinutes: null, incidentDate: null };
async function api(t, provider) {
  const server = createApp(config, provider).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return (path, body) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test('primary intent envelope and bare intent API expose the same provider mode without changing JSON contracts', async t => {
  for (const mode of ['demo', 'live']) {
    // A live label is exercised with an injected local provider, never Gemini transport.
    const call = await api(t, { ...createDemoProvider(), mode });
    const envelope = await call('/intelligence/understand', { message: DEMO_STORY });
    assert.equal(envelope.headers.get('X-NAVI-AI-Mode'), mode);
    const understanding = UnderstandingSchema.parse(await envelope.json());
    assert.equal(understanding.data.serviceType, 'hospitalization_claim');
    assert.equal(understanding.meta.source, mode === 'demo' ? 'demo_fallback' : 'gemini');
    const bare = await call('/analyze-intent', { message: DEMO_STORY });
    assert.equal(bare.headers.get('X-NAVI-AI-Mode'), mode);
    assert.deepEqual(await bare.json(), understanding.data);
    const journey = await call('/journeys', { message: DEMO_STORY });
    assert.equal(journey.status, 201);
    assert.equal(journey.headers.get('X-NAVI-AI-Mode'), mode);
    assert.equal(ServiceJourneySchema.parse(await journey.json()).readiness, 35);
  }
});

test('unknown results cannot retain high confidence or unrelated facts through either intent entry point', async t => {
  const raw = { intent: 'service_request', serviceType: 'unknown', confidence: .99, summary: '需要補充說明', extractedData: { ...facts, hospitalName: 'NAVI SYNTHETIC HOSPITAL' } };
  assert.equal(normalizeIntent(raw).confidence, .4);
  assert.equal(normalizeIntent({ ...raw, intent: 'unknown', serviceType: 'hospitalization_claim' }).confidence, .4);
  const call = await api(t, { mode: 'demo', understandIntent: async () => raw });
  const envelope = UnderstandingSchema.parse(await (await call('/intelligence/understand', { message: '我有個問題' })).json());
  assert.equal(envelope.meta.outcome, 'clarification');
  assert.equal(envelope.data.confidence, .4);
  assert.deepEqual(envelope.data.extractedData, facts);
  const journey = ServiceJourneySchema.parse(await (await call('/journeys', { message: '我有個問題', intentResult: raw })).json());
  assert.equal(journey.serviceType, 'unknown');
  assert.equal(journey.confidence, .4);
  assert.equal(journey.supported, false);
  assert.equal(journey.readiness, 0);
});

test('hard-budget HTTP failures stay in Traditional Chinese, preserve codes and never retry automatically', async t => {
  const budget = createAIRequestBudget(1);
  budget.consume();
  const call = await api(t, { mode: 'demo', understandIntent: async () => { budget.consume(); } });
  for (const code of ['AI_REQUEST_BUDGET_REACHED', 'AI_RATE_LIMITED']) {
    if (code === 'AI_RATE_LIMITED') budget.stop(code);
    const response = await call('/intelligence/understand', { message: DEMO_STORY });
    assert.equal(response.status, 429);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, code);
    assert.equal(body.error.retryable, false);
    assert.match(body.error.message, /示範模式/);
    assert.doesNotMatch(body.error.message, /Live AI|request budget/);
    assert.equal(budget.status().used, 1);
  }
});

test('existing browser Mock and server-owned hospital journeys agree on happy-path weights, scores, stages and removal', async () => {
  const provider = createDemoProvider();
  const understanding = await understandIntent(DEMO_STORY, { provider, config });
  const service = createJourneyService({ provider, config, repository: new InMemoryJourneyRepository() });
  let backend = await service.create({ message: DEMO_STORY });
  let browser = createSession(DEMO_STORY, understanding);
  const compare = score => {
    const local = toSnapshot(browser).journey;
    assert.equal(backend.readiness, score);
    assert.equal(local.readiness, score);
    assert.equal(local.currentStage, backend.currentStage);
    assert.deepEqual(local.requirements.map(({ id, weight, status, required }) => ({ id, weight, status, required })), backend.requirements.map(({ id, weight, status, required }) => ({ id, weight, status, required })));
  };
  compare(35);
  for (const [documentType, score] of [['diagnosis_certificate', 70], ['bank_passbook', 90]]) {
    const bytes = samplePdf(documentType);
    backend = (await service.addDocument(backend.id, { documentType, bytes, mimeType: 'application/pdf', size: bytes.length, filename: 'NAVI-synthetic.pdf' })).journey;
    browser = applySampleDocument(browser, documentType);
    compare(score);
  }
  backend = await service.review(backend.id);
  browser = confirmSession(browser);
  compare(100);
  backend = await service.removeDocument(backend.id, backend.documents.find(doc => doc.documentType === 'bank_passbook').id);
  browser = removeDocument(browser, 'bank_passbook');
  compare(70);
  assert.equal(backend.confirmed, false);
  assert.equal(browser.confirmed, false);
});
