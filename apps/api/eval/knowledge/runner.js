import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { z } from 'zod';
import * as productionEngine from '../../../../shared/knowledge/index.js';
import { searchPublicKnowledge } from '../../src/services/knowledgeService.js';
import { offlineNetworkStats } from '../../test/networkGuard.js';

const common = { id: z.string().min(1), synthetic: z.literal(true), requiresSourceIds: z.array(z.string()).optional() };
const datasetSchema = z.array(z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('query'), query: z.string(), status: z.enum(['answered', 'not_found', 'out_of_scope']), expectedTop1: z.string().nullable(), expectedTop3: z.array(z.string()), group: z.enum(['frontend_baseline', 'new_retrieval', 'unsupported', 'scope']) }).strict(),
  z.object({ ...common, kind: z.literal('navigation'), sourceId: z.string(), patch: z.object({ path: z.string().optional(), anchor: z.string().optional(), sourceUrl: z.string().optional(), retrievedAt: z.string().optional(), sourceId: z.string().optional() }).strict(), accepted: z.boolean() }).strict(),
])).min(40);
export async function loadKnowledgeDataset() {
  const text = await readFile(new URL('./cases.jsonl', import.meta.url), 'utf8');
  const cases = datasetSchema.parse(text.trim().split('\n').map(line => JSON.parse(line)));
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
  return cases;
}
export function evaluateKnowledge(cases, engine = productionEngine) {
  const { searchKnowledge, getKnowledgeEntry, knowledgeSource, retrieveKnowledgeContext, verifyKnowledgeSource, verifyEvidenceSnippet, verifyNavigationDestination } = engine;
  // New-source checks cannot invalidate rollback to a release predating those sources.
  const datasetTotal = cases.length;
  const skippedVersionCases = cases.filter(item => item.requiresSourceIds?.some(id => !getKnowledgeEntry(id))).map(item => item.id);
  cases = cases.filter(item => !skippedVersionCases.includes(item.id));
  const counters = Object.fromEntries(['top1Accuracy', 'top3Recall', 'unsupportedQueryRejection', 'outOfScopeDetection', 'navigationAccuracy'].map(k => [k, { passed: 0, total: 0 }]));
  const count = (metric, passed) => { counters[metric].total++; if (passed) counters[metric].passed++; };
  let sourceCount = 0, invalidSources = 0, routeCount = 0, invalidRoutes = 0;
  const results = [], latencies = [];
  for (const item of cases) {
    let passed = true;
    if (item.kind === 'navigation') {
      const target = structuredClone(getKnowledgeEntry(item.sourceId).destination);
      const patch = item.patch;
      for (const k of ['path', 'anchor']) if (patch[k] !== undefined) target[k] = patch[k];
      if (patch.sourceUrl !== undefined) target.source.url = patch.sourceUrl;
      if (patch.retrievedAt !== undefined) target.source.retrievedAt = patch.retrievedAt;
      const accepted = verifyNavigationDestination(target, patch.sourceId ?? item.sourceId);
      passed = accepted === item.accepted;
      count('navigationAccuracy', passed);
    } else {
      const start = performance.now();
      const actual = searchKnowledge(item.query);
      latencies.push(performance.now() - start);
      if (engine === productionEngine) assert.deepEqual(searchPublicKnowledge(item.query), actual, 'Backend and browser-capable shared adapter must agree');
      passed = actual.status === item.status;
      if (item.expectedTop1) {
        const top1 = actual.results[0]?.id === item.expectedTop1;
        const top3 = item.expectedTop3.every(id => actual.results.slice(0, 3).some(r => r.id === id));
        count('top1Accuracy', top1); count('top3Recall', top3);
        count('navigationAccuracy', actual.results[0]?.id === item.expectedTop1 && verifyNavigationDestination(actual.results[0].destination, item.expectedTop1));
        passed &&= top1 && top3;
      } else if (item.status === 'not_found') count('unsupportedQueryRejection', passed && actual.results.length === 0);
      else count('outOfScopeDetection', passed && actual.results.length === 0);
      for (const entry of [...actual.results, ...actual.related]) {
        sourceCount++; routeCount++;
        if (!verifyKnowledgeSource(knowledgeSource(entry))) invalidSources++;
        if (!verifyNavigationDestination(entry.destination, entry.id)) invalidRoutes++;
      }
      for (const [id, snippets] of Object.entries(actual.highlights)) for (const snippet of snippets) assert.ok(verifyEvidenceSnippet(id, snippet));
      const context = retrieveKnowledgeContext(item.query);
      if (actual.status !== 'answered') assert.equal(context, null);
      if (context) for (const line of context.answer.split('\n')) assert.ok(context.sourceIds.some(id => verifyEvidenceSnippet(id, line)), 'Exact snapshot evidence only');
    }
    results.push({ id: item.id, kind: item.kind, passed });
  }
  latencies.sort((a, b) => a - b);
  const percentile = fraction => Number(latencies[Math.ceil(fraction * latencies.length) - 1].toFixed(3));
  const metrics = Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, { ...v, rate: v.total ? v.passed / v.total : null }]));
  metrics.invalidSourceRate = { invalid: invalidSources, total: sourceCount, rate: sourceCount ? invalidSources / sourceCount : null };
  metrics.invalidRouteRate = { invalid: invalidRoutes, total: routeCount, rate: routeCount ? invalidRoutes / routeCount : null };
  metrics.latencyMs = { p50: percentile(.5), p95: percentile(.95), samples: latencies.length, scope: 'warm local shared retrieval; excludes HTTP and module initialization' };
  const network = offlineNetworkStats();
  assert.equal(network.blockedExternalAttempts, 0, 'Local evaluation must not even attempt an external request');
  return { scope: 'local_knowledge', datasetTotal, skippedVersionCases, total: results.length, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length,
    newCases: cases.filter(c => c.kind === 'navigation' || c.group === 'new_retrieval').length,
    newRetrievalCases: cases.filter(c => c.kind === 'query' && c.group === 'new_retrieval').length,
    metrics, geminiRequests: network.externalRequests, paidApiCalls: 0, blockedExternalAttempts: network.blockedExternalAttempts,
    interpretation: '本地 Snapshot 檢索測試；不是 Gemini 準確率，也不代表理賠資格或結果。', results };
}
