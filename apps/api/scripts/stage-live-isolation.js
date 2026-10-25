// Explicit operator tool: four synthetic requests maximum; never invoked by CI or deployment.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config/env.js';
import { assertLiveAllowed } from '../src/ai/costGuard.js';
import { createGeminiProvider } from '../src/services/gemini.service.js';
import { createApp } from '../src/app.js';
import { samplePdf } from '../test/sampleDocuments.js';

if (process.argv[2] !== '--execute-four' || process.env.AI_SYNTHETIC_TEST_ONLY !== 'true') throw new Error('Requires explicit four-request authorization and synthetic-only configuration');
const directory = resolve(process.env.NAVI_STAGE_OUTPUT || 'artifacts/live-isolation/stage-a');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const origin = 'https://app.navitw.com';
const config = loadConfig({ ...process.env, AI_MODE: 'live', LIVE_AI_REQUEST_LIMIT: '4', AI_DAILY_REQUEST_LIMIT: '4', AI_MAX_CONCURRENT: '1', AI_MAX_ATTEMPTS: '1', AI_USAGE_FILE: `${directory}/usage.json`, NAVI_TEST_SESSION_TOKEN: randomBytes(32).toString('hex'), WEB_ORIGINS: origin });
assertLiveAllowed(config);
if (!config.apiKey) throw new Error('Backend key missing');
let actualRequests = 0;
const provider = createGeminiProvider(config, async (...args) => { if (++actualRequests > 4) throw new Error('Stage budget exhausted'); return fetch(...args); });
const http = createApp(config, provider).listen(0, '127.0.0.1');
await new Promise(resolve => http.once('listening', resolve));
const base = `http://127.0.0.1:${http.address().port}/api`;
const report = { startedAt: new Date().toISOString(), provider: 'gemini', model: config.model, syntheticOnly: true, fallbackUsed: false, approvedBudget: 4, calls: [], success: false };
let cookie;
async function post(path, body) {
  const response = await fetch(base + path, { method: 'POST', headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, body: body instanceof FormData ? body : JSON.stringify(body) });
  return response;
}
async function measured(label, path, body) {
  if (existsSync(config.usageFile)) {
    const delay = 5100 - (Date.now() - JSON.parse(readFileSync(config.usageFile, 'utf8')).lastRequestAt);
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  }
  const started = performance.now(); const before = actualRequests;
  const response = await post(path, body); const data = await response.json();
  report.calls.push({ label, httpStatus: response.status, providerHeader: response.headers.get('X-NAVI-AI-Mode'), responseTimeMs: Math.round(performance.now() - started), actualRequests: actualRequests - before, data });
  if (!response.ok || response.headers.get('X-NAVI-AI-Mode') !== 'live') throw new Error(data.error?.code || 'STAGE_FAILED');
  return data;
}
try {
  const session = await post('/test-sessions', { token: config.sessionToken, syntheticOnly: true });
  if (session.status !== 201) throw new Error('SESSION_FAILED');
  cookie = session.headers.get('set-cookie').split(';')[0];
  const message = '這是合成測試。我在 NAVI SYNTHETIC HOSPITAL 住院五天，要怎麼申請理賠？';
  const intent = await measured('hospitalization_intent', '/intelligence/understand', { message });
  if (intent.data.serviceType !== 'hospitalization_claim') throw new Error('UNEXPECTED_HOSPITAL_INTENT');
  const created = await post('/journeys', { message, intentResult: intent.data });
  const journey = await created.json();
  if (created.status !== 201 || journey.readiness !== 35 || actualRequests !== 1) throw new Error('JOURNEY_CREATION_FAILED');
  const address = await measured('address_intent', '/intelligence/understand', { message: '我搬家了，保單地址要怎麼改？' });
  report.addressServiceType = address.data.serviceType;
  const scores = [journey.readiness];
  // Enough separation for the local five-second pacing guard; no generation retries.
  for (const documentType of ['diagnosis_certificate', 'bank_passbook']) {
    const form = new FormData(); form.set('file', new Blob([samplePdf(documentType)], { type: 'application/pdf' }), 'NAVI-synthetic.pdf'); form.set('documentType', documentType);
    const data = await measured(documentType, `/journeys/${journey.id}/documents`, form);
    if (data.document.isMock || data.document.source !== 'live') throw new Error('PROVENANCE_FAILED');
    scores.push(data.journey.readiness);
  }
  const reviewed = await post(`/journeys/${journey.id}/review`, { confirmed: true });
  const final = await reviewed.json(); scores.push(final.readiness);
  report.readiness = scores;
  report.success = reviewed.ok && scores.join(',') === '35,70,90,100';
} catch (error) { report.errorCode = /^[A-Z_]+$/.test(error.message) ? error.message : 'STAGE_FAILED'; }
finally {
  report.actualRequests = actualRequests;
  report.budget = provider.getRequestBudget();
  report.metadata = provider.getDebugMetadata();
  report.finishedAt = new Date().toISOString();
  writeFileSync(`${directory}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  http.closeAllConnections(); await new Promise(resolve => http.close(resolve));
  console.log(JSON.stringify({ report: `${directory}/report.json`, actualRequests, success: report.success, errorCode: report.errorCode, readiness: report.readiness }));
  if (!report.success) process.exitCode = 1;
}
