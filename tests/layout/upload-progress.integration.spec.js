import { test, expect } from '@playwright/test';
import { createApp } from '../../apps/api/src/app.js';
import { createDemoProvider } from '../../apps/api/src/ai/demoProvider.js';
import { loadConfig } from '../../apps/api/src/config/env.js';

test('native browser XHR reports actual bytes and server analysis separately', async ({ page }) => {
  const config = loadConfig({ AI_MODE: 'demo', WEB_ORIGINS: 'http://127.0.0.1:4180' });
  const server = createApp(config, createDemoProvider()).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/journeys`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '我住院五天，要申請理賠' }) });
    expect(response.status).toBe(201);
    const journey = await response.json();
    await page.goto('/demo');
    const result = await page.evaluate(async ({ base, id }) => {
      const { xhrUpload } = await import('/src/services/apiJourney.js');
      const { samplePdfFile } = await import('/src/mocks/sampleDocuments.js');
      const body = new FormData(); body.set('file', samplePdfFile('diagnosis_certificate')); body.set('documentType', 'diagnosis_certificate');
      const events = [];
      const response = await xhrUpload(`${base}/api/journeys/${id}/documents`, { method: 'POST', body, onProgress: value => events.push(value) });
      return { status: response.status, events, result: await response.json() };
    }, { base, id: journey.id });
    expect(result.status).toBe(200);
    expect(result.events.some(e => e.phase === 'uploading' && e.loaded > 0 && e.total >= e.loaded)).toBe(true);
    expect(result.events.some(e => e.phase === 'analyzing')).toBe(true);
    expect(result.result.journey.readiness).toBe(70);
    expect(result.result.document.isMock).toBe(true);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
