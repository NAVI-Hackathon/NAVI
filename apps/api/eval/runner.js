import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createDemoProvider } from '../src/ai/demoProvider.js';
import { normalizeGeminiIntent, normalizeGeminiDocument } from '../src/ai/schemas.js';
import { documentVerified, calculateDelayMinutes } from '../src/services/documentValidationService.js';
import { checkEvidenceConsistency } from '../src/services/evidenceConsistencyService.js';
import { retrieveAnswerContext } from '../src/services/knowledgeService.js';
import { answerKnowledge, validateGroundedAnswer } from '../src/services/knowledgeAnswerService.js';
import { understandIntent } from '../src/services/intent.service.js';
import { analyzeDocument } from '../src/services/documentService.js';
import { createJourneyService } from '../src/services/journeyService.js';
import { InMemoryJourneyRepository } from '../src/repositories/inMemoryJourneyRepository.js';
import { deriveJourney } from '../src/workflow/journeyStateMachine.js';
import { samplePdf } from '../test/sampleDocuments.js';

export async function loadDataset() {
  const text = await readFile(new URL('./cases.jsonl', import.meta.url), 'utf8');
  const cases = text.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(new Set(cases.map(entry => entry.id)).size, cases.length, 'Case IDs must be unique');
  assert.ok(cases.every(entry => entry.synthetic === true && ['intent', 'document', 'consistency', 'knowledge', 'security'].includes(entry.kind)), 'Only curated synthetic inputs are allowed');
  return cases;
}
export function summarizeEvaluation(results, scope, requests = 0, skipped = 0) {
  const groups = {};
  for (const result of results) {
    const group = groups[result.kind] ??= { total: 0, passed: 0, failed: 0 };
    group.total++; group[result.passed ? 'passed' : 'failed']++;
  }
  const liveLatencies = results.filter(result => result.networkAttempts > 0).map(result => result.elapsedMs).sort((a, b) => a - b);
  const percentile = value => liveLatencies.length ? liveLatencies[Math.ceil(value * liveLatencies.length) - 1] : null;
  return { scope, total: results.length, passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length, skipped, requests, groups,
    freshLiveSamples: results.filter(result => result.networkAttempts > 0).length,
    cachedSamples: results.filter(result => result.cached).length,
    liveLatencyMs: { p50: percentile(0.5), p95: percentile(0.95) },
    interpretation: scope === 'local' ? 'Deterministic / scripted-demo fixtures only; not Gemini model accuracy.' : 'Small live sample and cached replay; not full model accuracy.', results };
}
export async function evaluateLocal(cases, config) {
  const demo = createDemoProvider(); const results = [];
  const service = createJourneyService({ provider: demo, config, repository: new InMemoryJourneyRepository() });
  const base = await service.create({ message: '我昨天從東京回台灣，班機延誤七小時' });
  for (const entry of cases) {
    const started = performance.now(); let failure;
    try {
      if (entry.kind === 'intent') {
        const actual = await demo.understandIntent(entry.message);
        assert.equal(actual.serviceType, entry.expectedService);
        if (entry.expectedDelay !== undefined) assert.equal(actual.extractedData.delayMinutes, entry.expectedDelay);
        const normalized = normalizeGeminiIntent(entry.output);
        assert.equal(normalized.serviceType, entry.expectedService);
        const journey = deriveJourney({ ...base, serviceType: normalized.serviceType, confidence: normalized.confidence, extractedData: normalized.extractedData }, config);
        assert.equal(journey.readiness, entry.expectedService === 'flight_delay' ? 35 : 0);
      } else if (entry.kind === 'document') {
        if (entry.invalid) assert.throws(() => normalizeGeminiDocument(entry.output));
        else {
          const document = normalizeGeminiDocument(entry.output);
          assert.equal(documentVerified(document, config.journeyConfidenceThreshold), entry.verified);
          if (entry.delayMinutes !== undefined) assert.equal(calculateDelayMinutes(document.fields), entry.delayMinutes);
        }
      } else if (entry.kind === 'consistency') {
        const documents = entry.documents.map(output => ({ ...normalizeGeminiDocument(output), id: randomUUID() }));
        const issues = checkEvidenceConsistency(documents, entry.incident ?? {});
        assert.deepEqual([...new Set(issues.map(issue => issue.type))].sort(), entry.expectedIssues.slice().sort());
        const journey = deriveJourney({ ...base, extractedData: { ...base.extractedData, ...entry.incident }, documents }, config);
        if (entry.expectedIssues.length) { assert.equal(journey.currentStage, 'HUMAN_REVIEW'); assert.equal(journey.nextAction.type, 'CONTACT_SPECIALIST'); }
      } else if (entry.kind === 'knowledge') {
        const context = retrieveAnswerContext(entry.question);
        if (!entry.supported) assert.equal(context, null);
        else {
          assert.ok(context);
          const raw = { answer: entry.answer ?? context.answer, confidence: 0.9, supported: true, sourceIds: entry.sourceIds ?? context.sourceIds };
          if (entry.invalid) assert.throws(() => validateGroundedAnswer(raw, context));
          else assert.ok(validateGroundedAnswer(raw, context).sourceIds.every(id => context.sourceIds.includes(id)));
        }
      } else if (entry.kind === 'security') {
        // Adversarial stored outputs test the business boundary, not live prompt resistance.
        if (entry.target === 'document') assert.throws(() => normalizeGeminiDocument(entry.output));
        else assert.throws(() => normalizeGeminiIntent(entry.output));
      }
    } catch { failure = 'EXPECTED_BEHAVIOR_MISMATCH'; }
    results.push({ id: entry.id, kind: entry.kind, passed: !failure, elapsedMs: Math.round(performance.now() - started), ...(failure ? { failure } : {}) });
  }
  const boarding = await service.addDocument(base.id, { documentType: 'boarding_pass', filename: 'synthetic.pdf', mimeType: 'application/pdf', bytes: samplePdf('boarding_pass'), size: samplePdf('boarding_pass').length });
  const delay = await service.addDocument(base.id, { documentType: 'delay_certificate', filename: 'synthetic.pdf', mimeType: 'application/pdf', bytes: samplePdf('delay_certificate'), size: samplePdf('delay_certificate').length });
  const review = await service.review(base.id);
  assert.deepEqual([base.readiness, boarding.journey.readiness, delay.journey.readiness, review.readiness], [35, 70, 90, 100]);
  return { ...summarizeEvaluation(results, 'local'), goldenPath: [35, 70, 90, 100] };
}
export function liveSamples(cases) {
  return cases.filter(entry => entry.liveSample === true);
}
export async function evaluateLive(cases, { provider, config, budget }) {
  const results = []; let stopped = null;
  for (const entry of cases) {
    const before = budget.status().used; const start = performance.now(); let errorCode;
    try {
      if (entry.kind === 'intent') {
        const result = await understandIntent(entry.message, { provider, config });
        assert.equal(result.data.serviceType, entry.expectedService);
        if (entry.expectedDelay !== undefined) assert.equal(result.data.extractedData.delayMinutes, entry.expectedDelay);
      } else if (entry.kind === 'document') {
        const bytes = samplePdf(entry.sampleType);
        const document = await analyzeDocument({ bytes, filename: 'synthetic.pdf', mimeType: 'application/pdf', size: bytes.length }, { provider, config });
        assert.equal(document.documentType, entry.sampleType); assert.equal(document.status, 'verified');
        const expected = normalizeGeminiDocument(entry.output).fields;
        for (const [field, value] of Object.entries(expected)) if (value !== null) {
          assert.ok(document.fields[field], `Missing synthetic field: ${field}`);
          if (['scheduledDeparture', 'actualDeparture', 'actualDepartureDate'].includes(field)) assert.equal(document.fields[field], value);
        }
        // Reuse the established airport/name/flight formatting comparison, without model-made rules.
        assert.deepEqual(checkEvidenceConsistency([
          { id: 'reference', documentType: 'boarding_pass', fields: expected },
          { id: 'sample', documentType: 'delay_certificate', fields: document.fields },
        ]), []);
        if (entry.sampleType === 'delay_certificate') assert.equal(document.fields.delayMinutes, 443);
      } else if (entry.kind === 'knowledge') {
        const answer = await answerKnowledge(entry.question, { provider, config });
        assert.equal(answer.answerMode, 'grounded_extract'); assert.ok(answer.sources.length);
      }
    } catch (error) { errorCode = error.code ?? 'EXPECTED_BEHAVIOR_MISMATCH'; }
    const attempts = budget.status().used - before;
    results.push({ id: entry.id, kind: entry.kind, passed: !errorCode, networkAttempts: attempts, cached: attempts === 0 && !errorCode, elapsedMs: Math.round(performance.now() - start), ...(errorCode ? { failure: errorCode } : {}) });
    if (budget.status().stopped || ['AI_RATE_LIMITED', 'AI_REQUEST_BUDGET_REACHED', 'FREE_TIER_NOT_CONFIRMED', 'LIVE_AI_DISABLED_IN_CI', 'PAID_AI_DISABLED', 'AI_NOT_CONFIGURED'].includes(errorCode)) { stopped = budget.status().stopped ?? errorCode; break; }
  }
  return { ...summarizeEvaluation(results, 'live_sample', budget.status().used, cases.length - results.length), stopped };
}
