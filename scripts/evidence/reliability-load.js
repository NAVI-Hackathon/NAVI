import assert from 'node:assert/strict';
import os from 'node:os';
import { createApp } from '../../apps/api/src/app.js';
import { loadConfig } from '../../apps/api/src/config/env.js';
import { latencySummary } from '../evidence-pack.js';
import { offlineNetworkStats } from '../../apps/api/test/networkGuard.js';
import { samplePdf } from '../../apps/api/test/sampleDocuments.js';
import { ApiError } from '../../apps/api/src/middleware/errorHandler.js';

// Intentionally creates its own loopback server: no production URL or live provider option.
const config = { ...loadConfig({ AI_MODE: 'demo', ALLOW_PAID_AI: 'false' }), rateLimit: 10000 };
const start = async (options = config, provider) => {
  const server = createApp(options, provider).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}/api`, close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }) };
};
const http = await start(); const levels = []; const failures = [];
let totalRequests = 0;
try {
  for (const concurrency of [1, 2, 4, 8]) {
    const latency = []; let errors = 0; const scores = [];
    const memoryBefore = process.memoryUsage().rss; const cpu = process.cpuUsage(); const begin = performance.now();
    async function request(path, body, expected = 200) {
      const since = performance.now();
      const res = await fetch(http.base + path, { method: body ? 'POST' : 'GET', ...(body instanceof FormData ? { body } : body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}), signal: AbortSignal.timeout(5000) });
      totalRequests++; latency.push(performance.now() - since);
      if (res.status !== expected) errors++;
      assert.equal(res.status, expected); return res.json();
    }
    const operations = Array.from({ length: 8 }, (_, i) => i);
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (operations.length) {
        operations.pop();
        let j = await request('/journeys', { message: '我上週在台中榮總住院五天，要怎麼申請理賠？' }, 201); const run = [j.readiness];
        for (const type of ['diagnosis_certificate', 'bank_passbook']) {
          const form = new FormData(); form.set('documentType', type); form.set('file', new Blob([samplePdf(type)], { type: 'application/pdf' }), 'synthetic.pdf');
          j = (await request(`/journeys/${j.id}/documents`, form)).journey; run.push(j.readiness);
        }
        j = await request(`/journeys/${j.id}/review`, { confirmed: true }); run.push(j.readiness);
        await request(`/journeys/${j.id}/explanation`);
        await request('/navigation/plans', { query: '我要變更地址' });
        assert.deepEqual(run, [35, 70, 90, 100]); scores.push(run);
      }
    }));
    const elapsedMs = performance.now() - begin; const usage = process.cpuUsage(cpu);
    levels.push({ concurrency, flows: scores.length, requests: latency.length, latencyMs: latencySummary(latency), errors, errorRate: errors / latency.length,
      elapsedMs, requestsPerSecond: latency.length * 1000 / elapsedMs, processRssBeforeBytes: memoryBefore, processRssAfterBytes: process.memoryUsage().rss,
      processCpuMs: (usage.user + usage.system) / 1000, systemFreeBytes: os.freemem(), systemLoad: os.loadavg() });
  }
  for (const [code, status] of [['AI_TIMEOUT', 504], ['AI_UNAVAILABLE', 503], ['AI_DAILY_LIMIT_REACHED', 429], ['AI_BUSY', 429]]) {
    let calls = 0;
    const fake = { mode: 'live', understandIntent: async () => { calls++; throw new ApiError(code, '合成故障測試，請稍後再試。', status, false); } };
    const fault = await start({ ...config, aiMode: 'live', aiMaxAttempts: 1 }, fake);
    try {
      const res = await fetch(fault.base + '/intelligence/understand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '合成住院需求' }) });
      const data = await res.json(); assert.equal(res.status, status); assert.equal(data.error.code, code); assert.equal(calls, 1);
      assert.equal(res.headers.get('X-NAVI-AI-Mode'), 'live'); failures.push({ code, status, pass: true, mockProviderCalls: calls, fallbackUsed: false });
    } finally { await fault.close(); }
  }
  const invalid = await fetch(http.base + '/navigation/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: 'service:change_address', destination: 'javascript:evil()' }) });
  assert.equal(invalid.status, 400); failures.push({ code: 'INVALID_NAVIGATION_INPUT', status: invalid.status, pass: true });
  const network = offlineNetworkStats(); assert.equal(network.blockedExternalAttempts, 0);
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), scope: 'loopback_demo_http_with_mock_fault_transports', levels, failures, totalRequests,
    network, liveGeminiRequests: 0, paidApiCalls: 0, limitations: ['本機 Mac 結果，不是 VPS 或 Gemini 延遲', '未對正式站執行壓力測試', '本程式不量測 OS OOM、Swap 或其他服務重啟；另記錄 VPS 觀測值', '32 次合成流程不能證明長期穩定性'] }, null, 2));
} finally { await http.close(); }
