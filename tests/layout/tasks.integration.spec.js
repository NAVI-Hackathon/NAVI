import { test, expect } from '@playwright/test';
import { createApp } from '../../apps/api/src/app.js';
import { createDemoProvider } from '../../apps/api/src/ai/demoProvider.js';
import { createGeminiProvider } from '../../apps/api/src/services/gemini.service.js';
import { loadConfig } from '../../apps/api/src/config/env.js';

// Real A client + real Express/receipts/validation; only the Gemini network transport is mocked.
for (const width of [390, 1280]) test(`formal chat selects both tasks, creates once and corrects server state — ${width}px`, async ({ page }) => {
  const origin = 'https://app.navitw.com', demo = createDemoProvider(), calls = []; let cookie, latest;
  const config = { ...loadConfig({ AI_MODE: 'live', AI_SYNTHETIC_TEST_ONLY: 'true', AI_PUBLIC_SYNTHETIC: 'true', GEMINI_API_KEY: 'synthetic-mock-key', GEMINI_FREE_TIER_CONFIRMED: 'true', WEB_ORIGINS: origin }), rateLimit: 1000 };
  const provider = createGeminiProvider(config, async (_url, options) => {
    const body = JSON.parse(options.body), message = body.contents[0].parts[0].text;
    const operation = body.generationConfig.responseJsonSchema.properties.tasks ? 'tasks' : 'intent'; calls.push(operation);
    const raw = operation === 'tasks' ? await demo.understandTasks(message) : await demo.understandIntent(message);
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] }));
  });
  const server = createApp(config, provider).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await page.route('**/api/**', async route => {
      const request = route.request();
      const response = await fetch(base + new URL(request.url()).pathname, { method: request.method(), headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(request.headers()['content-type'] ? { 'Content-Type': request.headers()['content-type'] } : {}) }, ...(request.postDataBuffer() ? { body: request.postDataBuffer() } : {}) });
      cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
      const text = await response.text(); const data = JSON.parse(text);
      if (data.journey) latest = data.journey; else if (data.id && data.readiness !== undefined) latest = data;
      await route.fulfill({ status: response.status, headers: { 'Content-Type': 'application/json', 'X-NAVI-AI-Mode': response.headers.get('X-NAVI-AI-Mode') }, body: text });
    });
    await page.setViewportSize({ width, height: 900 }); await page.goto('/');
    await page.locator('#story-input').fill('我想改地址，也想知道要怎麼申請住院理賠。'); await page.locator('#story-input').press('Enter');
    await expect(page.getByText('我聽到你有 2 件事')).toBeVisible();
    await page.getByRole('button', { name: '我想改地址', exact: true }).click();
    await expect(page.getByText('在官網資料中找到：')).toBeVisible();
    await page.getByRole('button', { name: '我也想知道要怎麼申請住院理賠', exact: true }).click();
    await page.getByRole('button', { name: '開啟工作區' }).click();
    await expect(page.locator('[role=progressbar][aria-label="準備完成度"]').first()).toHaveAttribute('aria-valuenow', '35');
    expect(calls).toEqual(['tasks']); expect(latest.serviceType).toBe('hospitalization_claim');
    const id = latest.id;
    await page.getByRole('button', { name: '需求不對？修正' }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('我其實不是住院，是門診');
    await page.getByRole('button', { name: '送出修正' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('heading', { name: '需要補充說明', exact: true, level: 1 })).toBeVisible();
    expect(latest.id).toBe(id); expect(latest.readiness).toBe(0); expect(latest.sources).toEqual([]); expect(calls).toEqual(['tasks', 'intent']);
  } finally { await page.unroute('**/api/**'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
