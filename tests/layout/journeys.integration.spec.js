import { test, expect } from '@playwright/test';
import { createApp } from '../../apps/api/src/app.js';
import { createDemoProvider } from '../../apps/api/src/ai/demoProvider.js';
import { createGeminiProvider } from '../../apps/api/src/services/gemini.service.js';
import { loadConfig } from '../../apps/api/src/config/env.js';

// A2 multi-task management against the real A client + real Express (journeys, receipts, ownership);
// only the Gemini network transport is mocked (no Google request). `override` lets one test answer a
// request itself (an expired receipt, a journey the server no longer has).
async function formalBackend(page, override = () => null) {
  const origin = 'https://app.navitw.com', demo = createDemoProvider(); let cookie;
  const config = { ...loadConfig({ AI_MODE: 'live', AI_SYNTHETIC_TEST_ONLY: 'true', AI_PUBLIC_SYNTHETIC: 'true', GEMINI_API_KEY: 'synthetic-mock-key', GEMINI_FREE_TIER_CONFIRMED: 'true', WEB_ORIGINS: origin }), rateLimit: 1000 };
  const provider = createGeminiProvider(config, async (_url, options) => {
    const body = JSON.parse(options.body), message = body.contents[0].parts[0].text;
    const raw = body.generationConfig.responseJsonSchema.properties.tasks ? await demo.understandTasks(message) : await demo.understandIntent(message);
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] }));
  });
  const server = createApp(config, provider).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const own = override(request);
    if (own) { await route.fulfill({ status: own.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(own.body) }); return; }
    const response = await fetch(base + new URL(request.url()).pathname, { method: request.method(), headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(request.headers()['content-type'] ? { 'Content-Type': request.headers()['content-type'] } : {}) }, ...(request.postDataBuffer() ? { body: request.postDataBuffer() } : {}) });
    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
    // The page may have cancelled the request meanwhile (a newer list or switch replaced it).
    await route.fulfill({ status: response.status, headers: { 'Content-Type': 'application/json', 'X-NAVI-AI-Mode': response.headers.get('X-NAVI-AI-Mode') }, body: await response.text() }).catch(() => {});
  });
  return async () => { await page.unroute('**/api/**'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
}

async function ask(page, text) {
  await page.locator('#story-input').fill(text);
  await page.locator('#story-input').press('Enter');
}
const chip = (page, name) => page.locator('.task-chip', { hasText: name }).last();

for (const width of [390, 1280]) test(`two journeys: listed by hospital, switched from server state, kept after reload — ${width}px`, async ({ page }) => {
  const close = await formalBackend(page);
  try {
    await page.setViewportSize({ width, height: 900 }); await page.goto('/');
    await ask(page, '我上週在台中榮總住院五天，要怎麼申請理賠？');
    await expect(page.getByRole('button', { name: '開啟工作區' })).toBeVisible();
    await ask(page, '我上個月在臺大醫院住院三天，想申請住院理賠');
    // The chat offers the earlier journey; the shown one is marked.
    await expect(chip(page, '臺大醫院')).toHaveAttribute('aria-current', 'true');
    await chip(page, '臺中榮民總醫院').click();
    await expect(page.locator('.trip-strip strong').first()).toHaveText('臺中榮民總醫院');
    await expect(page.getByRole('navigation', { name: '你的任務' })).toBeVisible();
    await expect(chip(page, '臺中榮民總醫院')).toHaveAttribute('aria-current', 'true');

    // The browser keeps ids only; a reload reads both journeys back from the server.
    const stored = await page.evaluate(() => localStorage.getItem('navi.journey'));
    expect(stored).not.toMatch(/台中|臺中|臺大|住院/);
    await page.reload();
    await expect(page.locator('.trip-strip strong').first()).toHaveText('臺中榮民總醫院');
    await expect(page.locator('.task-chip')).toHaveCount(2);
  } finally { await close(); }
});

test('a task whose analysis expired says so, offers re-analysis and keeps the other task', async ({ page }) => {
  const close = await formalBackend(page, request => (request.method() === 'POST' && new URL(request.url()).pathname === '/api/journeys'
    ? { status: 409, body: { success: false, error: { code: 'INTENT_RECEIPT_REQUIRED', message: '需求分析已失效或內容不符，請重新分析後再選擇任務。', retryable: false } } }
    : null));
  try {
    await page.setViewportSize({ width: 390, height: 900 }); await page.goto('/');
    await ask(page, '我想改地址，也想知道要怎麼申請住院理賠。');
    await page.getByRole('button', { name: '我也想知道要怎麼申請住院理賠', exact: true }).click();
    await expect(page.getByText('這件事的需求分析已失效')).toBeVisible();
    await expect(page.getByRole('button', { name: /重新分析/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '我想改地址', exact: true })).toBeVisible();
  } finally { await close(); }
});

test('one expired journey leaves the list; the other stays and opens', async ({ page }) => {
  let expired = null;
  const close = await formalBackend(page, request => (expired && request.method() === 'GET' && new URL(request.url()).pathname === `/api/journeys/${expired}`
    ? { status: 404, body: { success: false, error: { code: 'JOURNEY_NOT_FOUND', message: 'not found', retryable: false } } }
    : null));
  try {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
    await ask(page, '我上週在台中榮總住院五天，要怎麼申請理賠？');
    await expect(page.getByRole('button', { name: '開啟工作區' })).toBeVisible();
    expired = JSON.parse(await page.evaluate(() => localStorage.getItem('navi.journey'))).current;
    await ask(page, '我上個月在臺大醫院住院三天，想申請住院理賠');
    await chip(page, '臺中榮民總醫院').click();
    await expect(page.getByText(/已從清單移除；其他事情不受影響/)).toBeVisible();
    await expect(chip(page, '臺中榮民總醫院')).toHaveCount(0);
    await page.getByRole('button', { name: '開啟工作區' }).last().click();
    await expect(page.locator('.trip-strip strong').first()).toHaveText('臺大醫院');
  } finally { await close(); }
});
