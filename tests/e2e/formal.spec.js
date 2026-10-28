import { test, expect } from '@playwright/test';
import { createApp } from '../../apps/api/src/app.js';
import { createDemoProvider } from '../../apps/api/src/ai/demoProvider.js';
import { createGeminiProvider } from '../../apps/api/src/services/gemini.service.js';
import { loadConfig } from '../../apps/api/src/config/env.js';

// Formal NAVI (the real A client, not /demo) embedded in the mock insurer site, against the real Express
// app: journeys, receipts, documents, handoff and deletion are the server's. Only the Gemini network
// transport is replaced: it answers with the scripted demo understanding, or fails like Google would.
// Against a deployed release (E2E_BASE_URL) there is no test API to point at, so this file is skipped.
test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the local test API');

const navi = page => page.frameLocator('iframe[title="NAVI 服務導航助手"]');
const ring = page => navi(page).locator('[role=progressbar][aria-label="準備完成度"]').first();

async function formalBackend(context) {
  const origin = 'https://app.navitw.com', demo = createDemoProvider();
  const state = { calls: [], fail: null, cookie: null };
  const config = { ...loadConfig({ AI_MODE: 'live', AI_SYNTHETIC_TEST_ONLY: 'true', AI_PUBLIC_SYNTHETIC: 'true', GEMINI_API_KEY: 'synthetic-mock-key', GEMINI_FREE_TIER_CONFIRMED: 'true', WEB_ORIGINS: origin }), rateLimit: 1000 };
  const provider = createGeminiProvider(config, async (_url, options) => {
    const body = JSON.parse(options.body), message = body.contents[0].parts[0].text;
    const operation = body.generationConfig.responseJsonSchema.properties.tasks ? 'tasks' : 'intent';
    state.calls.push(operation);
    if (state.fail) return new Response(JSON.stringify({ error: { code: state.fail, message: 'synthetic failure' } }), { status: state.fail });
    const raw = operation === 'tasks' ? await demo.understandTasks(message) : await demo.understandIntent(message);
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] }));
  });
  // Document reading stands in for Gemini with the scripted fields of the synthetic file (no Google call).
  const server = createApp(config, { ...provider, analyzeDocument: (upload, signal) => demo.analyzeDocument(upload, signal) }).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  await context.route('**/api/**', async route => {
    const request = route.request();
    const response = await fetch(base + new URL(request.url()).pathname + new URL(request.url()).search, { method: request.method(), headers: { Origin: origin, ...(state.cookie ? { Cookie: state.cookie } : {}), ...(request.headers()['content-type'] ? { 'Content-Type': request.headers()['content-type'] } : {}) }, ...(request.postDataBuffer() ? { body: request.postDataBuffer() } : {}) });
    state.cookie = response.headers.get('set-cookie')?.split(';')[0] ?? state.cookie;
    await route.fulfill({ status: response.status, headers: { 'Content-Type': 'application/json', 'X-NAVI-AI-Mode': response.headers.get('X-NAVI-AI-Mode') ?? 'live' }, body: await response.text() }).catch(() => {});
  });
  state.close = async () => { await context.unroute('**/api/**'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  state.journey = id => fetch(`${base}/api/journeys/${id}`, { headers: { Origin: origin, Cookie: state.cookie } }).then(r => r.json());
  return state;
}

async function openNavi(page, path = '/') {
  await page.goto(path);
  await page.locator('[data-tour-id="navi-launcher"]').click();
  await expect(navi(page).getByText('嗨，我是 NAVI')).toBeVisible({ timeout: 30_000 });
}
async function ask(page, text) {
  const input = navi(page).locator('#story-input');
  await input.fill(text);
  await input.press('Enter');
}
async function expectOutlined(page, anchor) {
  await expect(page.locator(`[data-tour-id="${anchor}"]`)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.navi-spot')).toBeVisible({ timeout: 15_000 });
}
const backToNavi = async (page, phone) => { if (phone) await page.getByRole('button', { name: /回到 NAVI/ }).click(); };
const storedJourney = page => page.frames().find(f => f.url().includes('/embed'))?.evaluate(() => JSON.parse(sessionStorage.getItem('navi.journey') ?? 'null'));

for (const device of [{ name: 'desktop', viewport: { width: 1280, height: 860 }, phone: false }, { name: 'phone', viewport: { width: 390, height: 844 }, phone: true }]) {
  test.describe(`formal ${device.name}`, () => {
    test.use({ viewport: device.viewport, ...(device.phone ? { hasTouch: true, isMobile: true } : {}) });

    test('多意圖 → 地址導覽 → 住院旅程：文件上傳、刪除，重新整理後恢復', async ({ page, context }) => {
      const backend = await formalBackend(context);
      try {
        await openNavi(page);
        // Live AI answers here: no demo notice.
        await expect(navi(page).getByText('NAVI 服務目前以示範資料回答')).toHaveCount(0);
        await ask(page, '我想改地址，也想知道要怎麼申請住院理賠。');
        await expect(navi(page).getByText('我聽到你有 2 件事')).toBeVisible();
        await navi(page).getByRole('button', { name: '我想改地址', exact: true }).click();
        await navi(page).getByRole('button', { name: /帶我去：查看變更戶籍地址/ }).last().click();
        await expect(page).toHaveURL(/\/services\/policy-change/);
        await expectOutlined(page, 'service-change-address');
        await backToNavi(page, device.phone);
        await expect(navi(page).locator('.guide-card').getByText('官網已帶到這裡並標示出來')).toBeVisible();
        await navi(page).getByRole('button', { name: '結束導覽' }).click();

        await navi(page).getByRole('button', { name: '我也想知道要怎麼申請住院理賠', exact: true }).click();
        await navi(page).getByRole('button', { name: '開啟工作區' }).click();
        await expect(ring(page)).toHaveAttribute('aria-valuenow', '35');
        expect(backend.calls).toEqual(['tasks']); // one AI call for both requests, none for choosing

        await navi(page).getByRole('tab', { name: /文件/ }).click();
        const certificate = navi(page).locator('[data-document="diagnosis_certificate"]');
        await certificate.getByRole('button', { name: '使用合成範例（由 AI 辨識）' }).click();
        await expect(certificate.getByRole('button', { name: /替換文件/ })).toBeVisible({ timeout: 30_000 });
        await expect(navi(page).getByRole('tab', { name: /文件/ })).toContainText('1/2');
        const id = (await storedJourney(page)).current;
        expect((await backend.journey(id)).documents).toHaveLength(1);
        await certificate.getByRole('button', { name: '移除診斷書或住院證明' }).click();
        await certificate.getByRole('button', { name: '移除文件' }).click();
        await expect(navi(page).getByRole('tab', { name: /文件/ })).toContainText('0/2');
        expect((await backend.journey(id)).documents).toHaveLength(0);

        // History: a reload of the insurer site reads the journey back from the server.
        await page.reload();
        await page.locator('[data-tour-id="navi-launcher"]').click();
        await expect(ring(page)).toHaveAttribute('aria-valuenow', '35', { timeout: 30_000 });
      } finally { await backend.close(); }
    });
  });
}

test.describe('formal desktop', () => {
  test.use({ viewport: { width: 1280, height: 860 } });

  test('任務切換與需求修正：兩件住院理賠來回切換，修正後改為精簡工作區', async ({ page, context }) => {
    const backend = await formalBackend(context);
    try {
      await openNavi(page);
      await ask(page, '我上週在台中榮總住院五天，要怎麼申請理賠？');
      await expect(navi(page).getByRole('button', { name: '開啟工作區' })).toBeVisible({ timeout: 15_000 });
      await ask(page, '我上個月在臺大醫院住院三天，想申請住院理賠');
      await navi(page).getByRole('button', { name: '開啟工作區' }).last().click();
      const bar = navi(page).getByRole('navigation', { name: '你的任務' });
      await bar.locator('.task-chip', { hasText: '臺中榮民總醫院' }).click();
      await expect(navi(page).locator('.trip-strip strong').first()).toHaveText('臺中榮民總醫院');
      await bar.locator('.task-chip', { hasText: '臺大醫院' }).click();
      await expect(navi(page).locator('.trip-strip strong').first()).toHaveText('臺大醫院');

      await navi(page).getByRole('button', { name: '需求不對？修正' }).click();
      await navi(page).getByRole('dialog').getByRole('textbox').fill('我其實不是住院，是門診');
      await navi(page).getByRole('button', { name: '送出修正' }).click();
      await expect(navi(page).locator('.workspace.profile-compact')).toBeVisible();
      await expect(navi(page).locator('[role=progressbar][aria-label="準備完成度"]')).toHaveCount(0);
    } finally { await backend.close(); }
  });

  test('交接摘要與資料刪除：確認後可下載；從瀏覽器移除這件事', async ({ page, context }) => {
    const backend = await formalBackend(context);
    try {
      await openNavi(page, '/services/claims');
      await ask(page, '我上週在台中榮總住院五天，要怎麼申請理賠？');
      await navi(page).getByRole('button', { name: '開啟工作區' }).click();
      await expect(ring(page)).toHaveAttribute('aria-valuenow', '35');
      await navi(page).getByRole('button', { name: /轉由專員接續/ }).first().click();
      const handoff = navi(page).getByRole('dialog', { name: '轉由專員協助' });
      await expect(handoff.getByText('摘要只列項目名稱')).toBeVisible();
      await handoff.getByRole('checkbox').check();
      await handoff.getByRole('button', { name: '確認並取得摘要' }).click();
      await expect(handoff.getByText('已取得交接摘要')).toBeVisible();
      const download = page.waitForEvent('download');
      await handoff.getByRole('button', { name: '下載摘要' }).click();
      expect((await download).suggestedFilename()).toBe('NAVI-交接摘要.txt');
      await handoff.getByRole('button', { name: '關閉' }).click();

      await navi(page).getByRole('button', { name: '資料與隱私' }).click();
      const privacy = navi(page).getByRole('dialog', { name: '資料與隱私' });
      await privacy.getByRole('button', { name: '從這個瀏覽器移除這件事' }).click();
      await privacy.getByRole('button', { name: '確定移除' }).click();
      await expect(navi(page).locator('#story-input')).toBeVisible();
      expect(await storedJourney(page)).toBeNull();
    } finally { await backend.close(); }
  });

  test('模型故障：顯示真實原因、提供重試與示範模式，不自動重送；恢復後重試成功', async ({ page, context }) => {
    const backend = await formalBackend(context);
    try {
      await openNavi(page);
      backend.fail = 503; // Google unavailable
      await ask(page, '我上週在台中榮總住院五天，要怎麼申請理賠？');
      await expect(navi(page).getByRole('button', { name: '重新分析' })).toBeVisible({ timeout: 30_000 });
      // The server's reason for a Google failure, then the official answer that does not need the AI.
      await expect(navi(page).getByText(/分析服務暫時無法回應|AI 分析服務暫時無法使用|分析服務暫時無法使用/).last()).toBeVisible();
      await expect(navi(page).getByRole('link', { name: '改用示範模式' }).last()).toBeVisible();
      const calls = backend.calls.length;
      await page.waitForTimeout(1500);
      expect(backend.calls.length).toBe(calls); // nothing re-sent on its own

      backend.fail = null;
      await navi(page).getByRole('button', { name: '重新分析' }).last().click();
      await expect(navi(page).getByRole('button', { name: '開啟工作區' })).toBeVisible({ timeout: 30_000 });
    } finally { await backend.close(); }
  });

  test('模型額度用完：說明是額度問題，並提供示範模式', async ({ page, context }) => {
    const backend = await formalBackend(context);
    try {
      await openNavi(page);
      // The server's own error for a spent free quota (as written by the backend).
      await context.route('**/api/intelligence/**', route => route.fulfill({ status: 429, headers: { 'Content-Type': 'application/json', 'X-NAVI-AI-Mode': 'live' }, body: JSON.stringify({ success: false, error: { code: 'AI_DAILY_LIMIT_REACHED', message: '今日 AI 分析次數已用完。', retryable: false } }) }));
      await ask(page, '我上週在台中榮總住院五天，要怎麼申請理賠？');
      await expect(navi(page).getByText(/今日 AI 分析次數已用完/).last()).toBeVisible({ timeout: 30_000 });
      await expect(navi(page).getByRole('link', { name: '改用示範模式' }).last()).toBeVisible();
      await context.unroute('**/api/intelligence/**');
    } finally { await backend.close(); }
  });
});
