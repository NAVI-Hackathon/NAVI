import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { createGeminiProvider } from '../src/services/gemini.service.js';
import { createDemoProvider } from '../src/ai/demoProvider.js';
import { createTestSessions } from '../src/middleware/testSession.js';
import { loadConfig } from '../src/config/env.js';
import { InMemoryJourneyRepository } from '../src/repositories/inMemoryJourneyRepository.js';
import { understandTasks } from '../src/services/taskService.js';
import { samplePdf } from './sampleDocuments.js';
import { result } from './fixtures.js';
import { offlineNetworkStats } from './networkGuard.js';
import { createApiJourneyService } from '../../web/src/services/apiJourney.js';
import { understandIntent as clientUnderstand } from '../../web/src/services/intelligence.js';

const origin = 'https://app.navitw.com';
const story = '我上週在台中榮總住院五天，要怎麼申請理賠？';
const demo = createDemoProvider();
const envelope = raw => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] }));
async function api(t, rawTasks = [{ input: story, data: result('hospitalization_claim') }], options = {}) {
  // Advance only the test clock across the existing five-second quota interval, never relax production guards.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const directory = mkdtempSync(join(tmpdir(), 'navi-receipt-'));
  const config = { ...loadConfig({ NODE_ENV: 'production', AI_MODE: 'live', AI_PUBLIC_SYNTHETIC: 'true', GEMINI_API_KEY: 'synthetic-mock-key', GEMINI_FREE_TIER_CONFIRMED: 'true', AI_USAGE_FILE: join(directory, 'usage.json'), WEB_ORIGINS: origin, AI_DAILY_REQUEST_LIMIT: '20', LIVE_AI_REQUEST_LIMIT: '20' }), rateLimit: 1000, ...options };
  const calls = [];
  const provider = createGeminiProvider(config, async (_url, request) => {
    const body = JSON.parse(request.body), parts = body.contents[0].parts;
    if (parts[1]?.inlineData) {
      const type = calls.filter(call => call === 'document').length ? 'bank_passbook' : 'diagnosis_certificate';
      assert.ok(Buffer.from(parts[1].inlineData.data, 'base64').equals(samplePdf(type)));
      calls.push('document');
      const fixture = await demo.analyzeDocument({ documentType: type });
      const fields = { passengerName: null, flightNumber: null, origin: null, destination: null, departureDate: null, actualDepartureDate: null, scheduledDeparture: null, actualDeparture: null, ...fixture.fields };
      delete fields.diagnosis; delete fields.inpatientDays; delete fields.inpatientDaysSource;
      return envelope({ ...fixture, fields });
    }
    if (body.generationConfig.responseJsonSchema.properties.tasks) { calls.push('tasks'); return envelope({ tasks: rawTasks }); }
    calls.push('intent');
    return envelope(await demo.understandIntent(parts[0].text));
  });
  const repository = new InMemoryJourneyRepository();
  const server = createApp(config, provider, repository).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, body, cookie, method = body === undefined ? 'GET' : 'POST') => {
    t.mock.timers.tick(5001);
    return fetch(base + path, { method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
  };
  const analysis = await request('/intelligence/tasks', { message: rawTasks.map(task => task.input).join('，') }); assert.equal(analysis.status, 200);
  const cookie = analysis.headers.get('set-cookie').split(';')[0], split = await analysis.json();
  return { request, cookie, split, calls, repository, provider, ledger: () => JSON.parse(readFileSync(config.usageFile)), config };
}
const select = task => ({ message: task.input, intentResult: task.data });

test('Single task → receipt create → two documents uses exactly 3 Gemini transport generations and a 3-attempt session', async t => {
  const a = await api(t, undefined, { sessionRequestLimit: 3 });
  const created = await a.request('/journeys', select(a.split.tasks[0]), a.cookie); assert.equal(created.status, 201); let j = await created.json();
  const scores = [j.readiness];
  for (const type of ['diagnosis_certificate', 'bank_passbook']) {
    const form = new FormData(); form.set('documentType', type); form.set('file', new Blob([samplePdf(type)], { type: 'application/pdf' }), 'NAVI-synthetic.pdf');
    const uploaded = await a.request(`/journeys/${j.id}/documents`, form, a.cookie); assert.equal(uploaded.status, 200); j = (await uploaded.json()).journey; scores.push(j.readiness);
  }
  assert.deepEqual(scores, [35, 70, 90]); assert.deepEqual(a.calls, ['tasks', 'document', 'document']);
  assert.equal(a.provider.getRequestBudget().used, 3); assert.equal(a.ledger().used, 3);
  const repeat = await a.request('/journeys', select(a.split.tasks[0]), a.cookie); assert.equal(repeat.status, 201); assert.equal((await repeat.json()).id, j.id);
  const denied = await a.request('/intelligence/understand', { message: story }, a.cookie); assert.equal(denied.status, 429); assert.equal((await denied.json()).error.code, 'AI_SESSION_LIMIT_REACHED'); assert.equal(a.calls.length, 3);
});

for (const count of [2, 3]) test(`${count} task receipts remain independent; reordered selections and parallel duplicate creation do not regenerate`, async t => {
  const raw = [{ input: '我想改地址', data: result('policy_change') }, { input: '也想申請住院理賠', data: result('hospitalization_claim') }, { input: '另外想更改信用卡扣款', data: result('payment_method_change') }].slice(0, count);
  const a = await api(t, raw, { sessionRequestLimit: 1 }); const ids = new Set();
  for (const task of [...a.split.tasks].reverse()) {
    const responses = await Promise.all(Array.from({ length: 5 }, () => a.request('/journeys', select(task), a.cookie)));
    const journeys = await Promise.all(responses.map(async response => { assert.equal(response.status, 201); return response.json(); }));
    assert.ok(journeys.every(j => j.id === journeys[0].id && j.serviceType === task.data.serviceType)); ids.add(journeys[0].id);
  }
  assert.equal(ids.size, count); assert.equal(a.repository.entries.size, count); assert.deepEqual(a.calls, ['tasks']); assert.equal(a.ledger().used, 1);
});

test('Receipt ignores forged intent fields, rejects modified task content and cross-session reuse without consuming Gemini', async t => {
  const a = await api(t); const task = a.split.tasks[0];
  const forged = await a.request('/journeys', { message: task.input, intentResult: result('flight_delay') }, a.cookie);
  assert.equal(forged.status, 201); assert.equal((await forged.json()).serviceType, 'hospitalization_claim');
  for (const [message, cookie] of [[task.input + '改地址', a.cookie], [task.input, undefined]]) {
    const denied = await a.request('/journeys', { message, intentResult: task.data }, cookie);
    assert.equal(denied.status, 409); assert.equal((await denied.json()).error.code, 'INTENT_RECEIPT_REQUIRED');
  }
  assert.deepEqual(a.calls, ['tasks']);
});

test('Expired receipt cannot trigger implicit re-analysis; expired session cannot reuse it', async () => {
  let clock = 1000000; const repository = new InMemoryJourneyRepository();
  const config = { restrictedLive: true, publicSynthetic: true, origins: [origin], aiMode: 'live' };
  const sessions = createTestSessions(config, repository, { providerMode: 'live', now: () => clock });
  const req = { headers: { origin }, method: 'POST' }, res = { cookie() {} };
  sessions.guard(req, res, error => assert.equal(error, undefined));
  sessions.remember(req, story, result('hospitalization_claim'), 'task-1'); clock += 300001;
  let calls = 0; await assert.rejects(sessions.createJourney(req, { message: story, intentResult: result('hospitalization_claim') }, () => { calls++; }), { code: 'INTENT_RECEIPT_REQUIRED' }); assert.equal(calls, 0);
  clock += 3600000;
  await assert.rejects(sessions.createJourney(req, { message: story }, () => { calls++; }), { code: 'TEST_SESSION_REQUIRED' }); assert.equal(calls, 0);
});

test('Receipt replay returns the current corrected state, never recreates the original hospital case', async t => {
  const a = await api(t), input = select(a.split.tasks[0]);
  const j = await (await a.request('/journeys', input, a.cookie)).json();
  const corrected = await a.request(`/journeys/${j.id}/intent-correction`, { message: '我其實不是住院，是門診' }, a.cookie);
  assert.equal(corrected.status, 200); assert.equal((await corrected.json()).journey.readiness, 0);
  const replay = await (await a.request('/journeys', input, a.cookie)).json(); assert.equal(replay.id, j.id); assert.equal(replay.serviceType, 'unknown'); assert.equal(replay.readiness, 0); assert.deepEqual(a.calls, ['tasks', 'intent']);
});

test('An older /tasks 404 client performs one understanding, then uses its receipt and resumes after refresh', async t => {
  const a = await api(t), baseline = a.calls.length; let cookie;
  const transport = async (url, options = {}) => {
    const path = new URL(url, 'http://client.invalid').pathname.replace(/^\/api/, '');
    if (path === '/intelligence/tasks') return new Response(JSON.stringify({ success: false, error: { code: 'NOT_FOUND' } }), { status: 404 });
    const body = options.body ? JSON.parse(options.body) : undefined;
    const response = await a.request(path, body, cookie, options.method ?? 'GET');
    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie; return response;
  };
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const client = () => createApiJourneyService({ storage, fetchImpl: transport, understand: message => clientUnderstand(message, { fetchImpl: transport }) });
  const first = client(); assert.equal(await first.understandTasks(story), null);
  const created = await first.analyze(story); assert.equal(created.snapshot.journey.readiness, 35);
  const refreshed = client(); refreshed.restore(); assert.equal((await refreshed.resume()).journey.id, created.snapshot.journey.id);
  assert.deepEqual(a.calls.slice(baseline), ['intent']);
});

test('Timed-out tasks analysis issues no receipt and a forged selection cannot trigger a hidden retry', async t => {
  let attempts = 0;
  const config = { ...loadConfig({ NODE_ENV: 'production', AI_MODE: 'live', AI_PUBLIC_SYNTHETIC: 'true', WEB_ORIGINS: origin }), timeoutMs: 20 };
  const provider = { mode: 'live', understandTasks: () => { attempts++; return new Promise(() => {}); }, understandIntent: () => { throw Error('must not retry'); } };
  const server = createApp(config, provider).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/api`, headers = { Origin: origin, 'Content-Type': 'application/json' };
  const failed = await fetch(url + '/intelligence/tasks', { method: 'POST', headers, body: JSON.stringify({ message: story }) });
  assert.equal(failed.status, 504); assert.equal((await failed.json()).error.code, 'AI_TIMEOUT');
  const cookie = failed.headers.get('set-cookie').split(';')[0];
  const rejected = await fetch(url + '/journeys', { method: 'POST', headers: { ...headers, Cookie: cookie }, body: JSON.stringify({ message: story, intentResult: result('hospitalization_claim') }) });
  assert.equal(rejected.status, 409); assert.equal((await rejected.json()).error.code, 'INTENT_RECEIPT_REQUIRED'); assert.equal(attempts, 1);
});

test('This integration suite did not make real Gemini requests', () => assert.deepEqual(offlineNetworkStats(), { externalRequests: 0, blockedExternalAttempts: 0 }));
