import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createDemoProvider } from '../../src/ai/demoProvider.js';
import { createGeminiProvider } from '../../src/services/gemini.service.js';
import { analyzeDocument } from '../../src/services/documentService.js';
import { createJourneyService } from '../../src/services/journeyService.js';
import { InMemoryJourneyRepository } from '../../src/repositories/inMemoryJourneyRepository.js';
import { matchPartnerHospital, calculateStay } from '../../../../shared/hospitalization.js';
import { ServiceJourneySchema } from '../../../../shared/journey.js';
import { summarizeEvaluation } from '../runner.js';
import { startHospitalApi, HOSPITAL_STORY, hospitalConfig } from '../../test/hospitalApi.js';
import { samplePdf } from '../../test/sampleDocuments.js';
import { offlineNetworkStats } from '../../test/networkGuard.js';

const common = { id: z.string().min(1), synthetic: z.literal(true) };
const fields = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
const casesSchema = z.array(z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('intent'), message: z.string(), expected: z.string(), negation: z.boolean(), unsupported: z.boolean() }).strict(),
  z.object({ ...common, kind: z.literal('hospital'), name: z.string(), expected: z.string().nullable() }).strict(),
  z.object({ ...common, kind: z.literal('document'), documentType: z.enum(['diagnosis_certificate', 'bank_passbook']), fields, status: z.enum(['verified', 'needs_review']), days: z.number().nullable(), source: z.enum(['dates', 'printed_days']).nullable(), invalid: z.boolean(), confidence: z.number().optional() }).strict(),
  z.object({ ...common, kind: z.literal('consistency'), incident: fields, diagnosis: fields, bank: fields, expectedIssues: z.array(z.string()) }).strict(),
  z.object({ ...common, kind: z.literal('workflow'), scenario: z.enum(['golden', 'remove-diagnosis', 'remove-bank', 'replace', 'reupload', 'concurrent', 'premature-review', 'missing', 'expired', 'restart', 'unsupported', 'proof-channel', 'unknown-kind', 'provider-business-fields', 'privacy', 'mock-live-boundary', 'information-only']), unsupported: z.boolean(), boundary: z.boolean() }).strict(),
])).min(50);
export async function loadHospitalDataset() {
  const text = await readFile(new URL('./cases.jsonl', import.meta.url), 'utf8');
  const cases = casesSchema.parse(text.trim().split('\n').map(line => JSON.parse(line)));
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
  return cases;
}
const empty = { origin: null, destination: null, delayMinutes: null, incidentDate: null };
async function responseJSON(response, status = 200) { assert.equal(response.status, status); return response.json(); }
async function fixture(type, overrides = {}) {
  const data = await createDemoProvider().analyzeDocument({ documentType: type });
  return { ...data, fields: { ...data.fields, ...overrides } };
}
function providerWithFields(patches) {
  return { ...createDemoProvider(), analyzeDocument: upload => fixture(upload.documentType, patches[upload.documentType]) };
}

async function workflowCase(scenario) {
  if (scenario === 'mock-live-boundary') {
    let calls = 0;
    const provider = createGeminiProvider({ ...hospitalConfig, aiMode: 'live', apiKey: 'synthetic-test-key', freeTierConfirmed: true, ci: true }, () => { calls++; throw new Error('Transport must not run'); });
    await assert.rejects(provider.understandIntent(HOSPITAL_STORY), { code: 'LIVE_AI_DISABLED_IN_CI' });
    assert.equal(calls, 0);
    return;
  }
  const patches = {};
  let provider = providerWithFields(patches);
  if (scenario === 'concurrent') {
    const waiting = [];
    provider = { ...provider, async analyzeDocument(upload) {
      await new Promise(resolve => { waiting.push(resolve); if (waiting.length === 2) waiting.forEach(release => release()); });
      return fixture(upload.documentType);
    } };
  }
  if (scenario === 'provider-business-fields') provider = { ...provider, analyzeDocument: async upload => ({ ...await fixture(upload.documentType), readiness: 100, currentStage: 'READY_TO_PROCEED' }) };
  if (scenario === 'proof-channel') patches.diagnosis_certificate = { certificateKind: 'hospitalization_proof' };
  if (scenario === 'unknown-kind') patches.diagnosis_certificate = { certificateKind: null };
  const repository = new InMemoryJourneyRepository();
  let api = await startHospitalApi({ provider, repository });
  try {
    if (scenario === 'missing') {
      for (const path of ['/journeys/missing', '/journeys/missing/handoff-summary']) assert.equal((await api.request(path)).status, 404);
      assert.equal((await api.upload('missing', 'diagnosis_certificate')).status, 404);
      assert.equal((await api.request('/journeys/missing/review', { confirmed: true })).status, 404);
      return;
    }
    const privacy = 'NAVI_SYNTHETIC_CLINICAL_DETAIL';
    if (scenario === 'information-only') {
      const response = await responseJSON(await api.request('/journeys', { message: '住院理賠需要什麼文件？', intentResult: { intent: 'knowledge_query', serviceType: 'hospitalization_claim', confidence: .94, summary: '住院文件資訊查詢', extractedData: empty } }), 409);
      assert.equal(response.error.code, 'SERVICE_NOT_SUPPORTED'); assert.equal(repository.entries.size, 0); return;
    }
    const journey = await api.create(scenario === 'unsupported' ? { message: '我要換信用卡扣款' } : scenario === 'privacy' ? {
      message: `${HOSPITAL_STORY} ${privacy} 合成帳號 00000000001234`,
      intentResult: { intent: 'service_request', serviceType: 'hospitalization_claim', confidence: .94, summary: privacy, extractedData: { ...empty } },
    } : undefined);
    ServiceJourneySchema.parse(journey);
    if (scenario === 'unsupported') {
      assert.equal(journey.supported, false); assert.equal(journey.readiness, 0);
      assert.equal((await api.upload(journey.id, 'diagnosis_certificate')).status, 409);
      return;
    }
    assert.equal(journey.readiness, 35);
    if (scenario === 'expired') repository.entries.get(journey.id).expiresAt = Date.now() - 1;
    if (scenario === 'restart') { await api.close(); api = await startHospitalApi(); }
    if (['expired', 'restart'].includes(scenario)) {
      const body = await responseJSON(await api.request(`/journeys/${journey.id}`), 404);
      assert.equal(body.error.code, 'JOURNEY_NOT_FOUND');
      assert.equal(body.error.message, '這份服務旅程已失效或不存在，請重新開始。');
      assert.equal((await api.upload(journey.id, 'diagnosis_certificate')).status, 404);
      assert.equal((await api.request(`/journeys/${journey.id}/review`, { confirmed: true })).status, 404);
      return;
    }
    if (scenario === 'premature-review') { assert.equal((await api.request(`/journeys/${journey.id}/review`, { confirmed: true })).status, 409); return; }
    if (scenario === 'provider-business-fields') {
      const failure = await responseJSON(await api.upload(journey.id, 'diagnosis_certificate'), 502);
      assert.equal(failure.error.code, 'AI_RESPONSE_INVALID');
      assert.equal((await responseJSON(await api.request(`/journeys/${journey.id}`))).readiness, 35);
      return;
    }
    if (scenario === 'privacy') patches.diagnosis_certificate = { diagnosis: privacy };
    let diagnosis, bank;
    if (scenario === 'concurrent') [diagnosis, bank] = await Promise.all(['diagnosis_certificate', 'bank_passbook'].map(async type => responseJSON(await api.upload(journey.id, type))));
    else {
      diagnosis = await responseJSON(await api.upload(journey.id, 'diagnosis_certificate', scenario === 'privacy' ? { filename: `${privacy}-00000000001234.pdf` } : undefined));
      if (scenario === 'unknown-kind') { assert.equal(diagnosis.document.status, 'needs_review'); assert.equal(diagnosis.journey.currentStage, 'HUMAN_REVIEW'); return; }
      assert.equal(diagnosis.journey.readiness, 70);
      bank = await responseJSON(await api.upload(journey.id, 'bank_passbook'));
      assert.equal(bank.journey.readiness, 90);
    }
    assert.ok(diagnosis.document.isMock && bank.document.isMock);
    const latest = ServiceJourneySchema.parse(await responseJSON(await api.request(`/journeys/${journey.id}`)));
    assert.equal(latest.documents.length, 2); assert.equal(latest.readiness, 90); assert.equal(latest.currentStage, 'READY_FOR_REVIEW');
    const review = await responseJSON(await api.request(`/journeys/${journey.id}/review`, { confirmed: true }));
    assert.equal(review.readiness, 100); assert.equal(review.currentStage, 'READY_TO_PROCEED');
    if (scenario === 'proof-channel') assert.equal(review.nextAction.target, 'union_chain');
    if (scenario === 'privacy') {
      const summary = await responseJSON(await api.request(`/journeys/${journey.id}/handoff-summary`));
      const stored = JSON.stringify({ review, summary, stored: repository.get(journey.id) });
      assert.ok(!stored.includes(privacy) && !stored.includes('00000000001234'));
      assert.equal(review.documents[0].fields.diagnosis, null);
    }
    if (scenario.startsWith('remove-') || scenario === 'reupload') {
      const removed = scenario === 'remove-diagnosis' ? diagnosis : bank;
      const result = await responseJSON(await api.request(`/journeys/${journey.id}/documents/${removed.document.id}`, undefined, 'DELETE'));
      assert.equal(result.readiness, scenario === 'remove-diagnosis' ? 55 : 70); assert.equal(result.confirmed, false);
      assert.equal((await api.request(`/journeys/${journey.id}/review`, { confirmed: true })).status, 409);
      if (scenario === 'reupload') assert.equal((await responseJSON(await api.upload(journey.id, 'bank_passbook'))).journey.readiness, 90);
    }
    if (scenario === 'replace') {
      patches.diagnosis_certificate = { patientName: null };
      const replacement = await responseJSON(await api.upload(journey.id, 'diagnosis_certificate'));
      assert.equal(replacement.journey.readiness, 55); assert.equal(replacement.journey.confirmed, false);
      assert.equal(replacement.journey.documents.filter(doc => doc.documentType === 'diagnosis_certificate').length, 1);
      assert.equal(replacement.journey.currentStage, 'HUMAN_REVIEW');
    }
  } finally { await api.close(); }
}

export async function evaluateHospitalization(cases) {
  const demo = createDemoProvider(); const results = []; const before = offlineNetworkStats();
  for (const entry of cases) {
    const started = performance.now(); let failure;
    try {
      if (entry.kind === 'intent') assert.equal((await demo.understandIntent(entry.message)).serviceType, entry.expected);
      if (entry.kind === 'hospital') assert.equal(matchPartnerHospital(entry.name), entry.expected);
      if (entry.kind === 'document') {
        const output = { ...await fixture(entry.documentType, entry.fields), ...(entry.confidence === undefined ? {} : { confidence: entry.confidence }) };
        const bytes = samplePdf(entry.documentType);
        const task = () => analyzeDocument({ bytes, filename: 'synthetic.pdf', mimeType: 'application/pdf', size: bytes.length }, { provider: { mode: 'demo', analyzeDocument: async () => output }, config: hospitalConfig });
        if (entry.invalid) await assert.rejects(task(), { code: 'AI_RESPONSE_INVALID' });
        else {
          const document = await task(); assert.equal(document.status, entry.status);
          if (entry.documentType === 'diagnosis_certificate') { assert.deepEqual(calculateStay(document.fields), { days: entry.days, source: entry.source }); assert.equal(document.fields.diagnosis, null); }
        }
      }
      if (entry.kind === 'consistency') {
        const service = createJourneyService({ provider: providerWithFields({ diagnosis_certificate: entry.diagnosis, bank_passbook: entry.bank }), config: hospitalConfig, repository: new InMemoryJourneyRepository() });
        const journey = await service.create({ message: '合成住院案例', intentResult: { intent: 'service_request', serviceType: 'hospitalization_claim', confidence: .94, summary: '合成住院案例', extractedData: { ...empty, ...entry.incident } } });
        let result;
        for (const documentType of ['diagnosis_certificate', 'bank_passbook']) { const bytes = samplePdf(documentType); result = await service.addDocument(journey.id, { bytes, documentType, filename: 'synthetic.pdf', mimeType: 'application/pdf', size: bytes.length }); }
        assert.deepEqual([...new Set(result.journey.consistencyIssues.map(issue => issue.type))].sort(), entry.expectedIssues.slice().sort());
        if (entry.expectedIssues.length) { assert.equal(result.journey.currentStage, 'HUMAN_REVIEW'); assert.equal(result.journey.nextAction.type, 'CONTACT_SPECIALIST'); }
      }
      if (entry.kind === 'workflow') await workflowCase(entry.scenario);
    } catch { failure = 'EXPECTED_BEHAVIOR_MISMATCH'; }
    const metrics = [{ intent: 'intentClassification', hospital: 'hospitalMatching', document: 'documentValidation', consistency: 'consistencyDetection', workflow: 'workflowBoundary' }[entry.kind], ...(entry.negation ? ['negationDetection'] : []), ...(entry.unsupported ? ['unsupportedHandling'] : []), ...(entry.boundary ? ['mockLiveBoundary'] : [])];
    results.push({ id: entry.id, kind: entry.kind, metrics, passed: !failure, elapsedMs: Math.round(performance.now() - started), ...(failure ? { failure } : {}) });
  }
  const stats = offlineNetworkStats();
  assert.equal(stats.blockedExternalAttempts - before.blockedExternalAttempts, 0, 'Evaluation attempted an external request');
  const metrics = Object.fromEntries(['intentClassification', 'negationDetection', 'hospitalMatching', 'documentValidation', 'consistencyDetection', 'workflowBoundary', 'unsupportedHandling', 'mockLiveBoundary'].map(name => {
    const selected = results.filter(result => result.metrics.includes(name)); const passed = selected.filter(result => result.passed).length;
    return [name, { passed, total: selected.length, passRate: passed / selected.length }];
  }));
  return { ...summarizeEvaluation(results, 'local', stats.externalRequests), metrics, geminiRequests: stats.externalRequests, paidApiCalls: 0, blockedExternalAttempts: stats.blockedExternalAttempts - before.blockedExternalAttempts, goldenPath: results.find(result => result.id === 'hospital-workflow-golden')?.passed ? [35, 70, 90, 100] : null };
}
