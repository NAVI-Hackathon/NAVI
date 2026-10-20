import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../../apps/api/src/app.js';
import { loadConfig } from '../../apps/api/src/config/env.js';
import { offlineNetworkStats } from '../../apps/api/test/networkGuard.js';
import { samplePdf } from '../../apps/api/test/sampleDocuments.js';
import { verifyNavigationPlan, buildNavigationPlan } from '../../shared/knowledge/navigationPlan.js';
import { verifyEvidenceSnippet, verifyKnowledgeSource, knowledgeEntries } from '../../shared/knowledge/index.js';
import { JourneyExplanationSchema, HandoffConfirmationSchema } from '../../shared/competition.js';

const http = createApp({ ...loadConfig({ AI_MODE: 'demo', ALLOW_PAID_AI: 'false' }), rateLimit: 1000 }).listen(0, '127.0.0.1');
await new Promise(resolve => http.once('listening', resolve));
const base = `http://127.0.0.1:${http.address().port}/api`;
const latencies = [];
const assertions = [];
async function request(path, { body, method = body ? 'POST' : 'GET', status = 200 } = {}) {
  const started = performance.now();
  const response = await fetch(base + path, { method, ...(body instanceof FormData ? { body } : body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}), signal: AbortSignal.timeout(5000) });
  const data = await response.json();
  latencies.push({ operation: path.replace(/[a-f0-9-]{36}/g, ':id'), elapsedMs: performance.now() - started });
  assert.equal(response.status, status, path);
  return data;
}
async function upload(id, documentType) {
  const body = new FormData(); body.set('documentType', documentType);
  body.set('file', new Blob([samplePdf(documentType)], { type: 'application/pdf' }), 'synthetic.pdf');
  return request(`/journeys/${id}/documents`, { body });
}
try {
  const queries = [
    ['住院理賠需要哪些文件', 'claim-doc:2'], ['我只有門診開刀，沒有住院，要怎麼申請理賠？', 'claim-doc:1'],
    ['我要變更地址', 'service:change_address'], ['保單借款怎麼申請', 'service:policy_loan'],
    ['受益人變更', 'service:change_beneficiary'],
  ];
  let checkedAnchors = 0;
  for (const [query, expected] of queries) {
    const result = await request('/navigation/plans', { body: { query } });
    assert.equal(result.status, 'answered'); assert.equal(result.plan.rootSourceId, expected);
    assert.ok(verifyNavigationPlan(result.plan));
    for (const step of result.plan.steps) {
      const path = step.destination.path === '/' ? 'index' : step.destination.path.slice(1);
      const html = await readFile(new URL(`../../apps/mock-site/.next/server/app/${path}.html`, import.meta.url), 'utf8');
      assert.ok(html.includes(`data-tour-id="${step.destination.anchor}"`) || html.includes(`id="${step.destination.anchor}"`), step.destination.anchor);
      checkedAnchors++;
    }
    const grounded = await request('/knowledge/evidence?query=' + encodeURIComponent(query));
    assert.equal(grounded.status, 'answered');
    for (const result of grounded.results) {
      assert.ok(verifyKnowledgeSource(result.source));
      assert.ok(result.excerpts.every(line => verifyEvidenceSnippet(result.source.id, line)));
      assert.equal(result.liveWebsiteChecked, false);
    }
  }
  const builtPages = new Map();
  let checkedPlans = 0;
  for (const entry of knowledgeEntries) {
    const plan = buildNavigationPlan(entry.id); assert.ok(verifyNavigationPlan(plan));
    for (const step of plan.steps) {
      const path = step.destination.path.slice(1) || 'index';
      if (!builtPages.has(path)) builtPages.set(path, await readFile(new URL(`../../apps/mock-site/.next/server/app/${path}.html`, import.meta.url), 'utf8'));
      const html = builtPages.get(path);
      assert.ok(html.includes(`data-tour-id="${step.destination.anchor}"`) || html.includes(`id="${step.destination.anchor}"`), `${entry.id}: ${step.destination.anchor}`);
      checkedAnchors++;
    }
    checkedPlans++;
  }
  assertions.push({ name: 'navigation_sources_excerpts_built_page_anchors', passed: true, queries: queries.length, checkedPlans, checkedAnchors });
  const readinessRuns = [];
  for (let index = 0; index < 5; index++) {
    const started = performance.now();
    let journey = await request('/journeys', { body: { message: '我上週在台中榮總住院五天，要怎麼申請理賠？' }, status: 201 });
    const scores = [journey.readiness];
    const diagnosis = await upload(journey.id, 'diagnosis_certificate'); scores.push(diagnosis.journey.readiness);
    journey = (await upload(journey.id, 'bank_passbook')).journey; scores.push(journey.readiness);
    journey = await request(`/journeys/${journey.id}/review`, { body: { confirmed: true } }); scores.push(journey.readiness);
    assert.deepEqual(scores, [35, 70, 90, 100]);
    const explanation = JourneyExplanationSchema.parse(await request(`/journeys/${journey.id}/explanation`));
    assert.equal(explanation.criteria.reduce((sum, row) => sum + row.earned, 0), 100);
    const preview = await request(`/journeys/${journey.id}/handoff/preview`, { body: {}, status: 201 });
    const confirmation = HandoffConfirmationSchema.parse(await request(`/journeys/${journey.id}/handoff/confirm`, { body: { previewId: preview.previewId, confirmed: true } }));
    assert.deepEqual(confirmation.summary, preview.summary); assert.equal(confirmation.delivery, 'not_sent');
    const removed = await request(`/journeys/${journey.id}/documents/${diagnosis.document.id}`, { method: 'DELETE' });
    assert.equal(removed.readiness, 55); assert.equal(removed.confirmed, false);
    readinessRuns.push({ scores, afterRemoval: removed.readiness, elapsedMs: performance.now() - started });
  }
  assertions.push({ name: 'hospitalization_explanation_handoff_and_removal', passed: true, runs: readinessRuns.length });
  const network = offlineNetworkStats(); assert.equal(network.blockedExternalAttempts, 0);
  console.log(JSON.stringify({ scope: 'local_backend_http_and_built_site_anchors', assertions, readinessRuns, latencies, network, liveGeminiRequests: 0,
    limitations: ['不含瀏覽器點擊與視覺驗收', '不含真實文件辨識', '延遲為本機合成資料 API 測試，不代表 VPS、Gemini 或使用者完成時間'] }, null, 2));
} finally { await new Promise(resolve => http.close(resolve)); }
