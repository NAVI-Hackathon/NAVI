import { test, expect } from '@playwright/test';
import { createApp } from '../../apps/api/src/app.js';
import { createDemoProvider } from '../../apps/api/src/ai/demoProvider.js';
import { loadConfig } from '../../apps/api/src/config/env.js';

// A6 assistive features: 找服務 (local snapshot, /demo), 辦理摘要 and 資料與隱私 against the real A client
// + real Express with the scripted demo provider (no AI call). `base` lets a test ask the server directly.
async function formalBackend(page) {
  const config = { ...loadConfig({ AI_MODE: 'demo' }), rateLimit: 1000 };
  const server = createApp(config, createDemoProvider()).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`; const jar = {};
  await page.route('**/api/**', async route => {
    const request = route.request();
    const response = await fetch(base + new URL(request.url()).pathname, { method: request.method(), headers: { ...(jar.cookie ? { Cookie: jar.cookie } : {}), ...(request.headers()['content-type'] ? { 'Content-Type': request.headers()['content-type'] } : {}) }, ...(request.postDataBuffer() ? { body: request.postDataBuffer() } : {}) });
    jar.cookie = response.headers.get('set-cookie')?.split(';')[0] ?? jar.cookie;
    await route.fulfill({ status: response.status, headers: { 'Content-Type': 'application/json', 'X-NAVI-AI-Mode': response.headers.get('X-NAVI-AI-Mode') ?? 'demo' }, body: await response.text() }).catch(() => {});
  });
  const close = async () => { await page.unroute('**/api/**'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  return { close, server: path => fetch(base + path, { headers: { Cookie: jar.cookie } }).then(r => r.json()) };
}

const ring = page => page.locator('[role=progressbar][aria-label="準備完成度"]').first();
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function openJourney(page, width = 1280) {
  await page.setViewportSize({ width, height: 900 }); await page.goto('/');
  await page.locator('#story-input').fill('我上週在台中榮總住院五天，要怎麼申請理賠？'); await page.locator('#story-input').press('Enter');
  await page.getByRole('button', { name: '開啟工作區' }).click();
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '35');
}

for (const width of [390, 1280]) test(`找服務: matches with sources and 帶我去, nothing found, out of scope — ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.addInitScript(() => { window.open = () => null; });
  await page.goto('/demo');
  await page.getByRole('button', { name: '找服務' }).click();
  const dialog = page.getByRole('dialog', { name: '找服務' });
  await dialog.getByRole('searchbox', { name: '搜尋服務' }).fill('地址');
  await expect(dialog.getByText(/找到 \d 筆官網資料/)).toBeVisible();
  await expect(dialog.getByText(/依據：官網/).first()).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await dialog.getByRole('button', { name: /帶我去：查看變更戶籍地址/ }).first().click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.guide-card')).toBeVisible();
  await page.getByRole('button', { name: '結束導覽' }).click();

  await page.getByRole('button', { name: '找服務' }).click();
  await dialog.getByRole('searchbox', { name: '搜尋服務' }).fill('火星移民');
  await expect(dialog.getByText('官網資料中沒有找到「火星移民」')).toBeVisible();
  await dialog.getByRole('searchbox', { name: '搜尋服務' }).fill('我該買哪一張保單比較划算');
  await expect(dialog.getByText(/不提供投保建議/)).toBeVisible();
});

test('辦理摘要: the journey state to copy or save, without document values', async ({ page, context }) => {
  const backend = await formalBackend(page);
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openJourney(page);
    await page.locator('[data-document="diagnosis_certificate"]').getByRole('button', { name: '使用合成範例（示範資料辨識）' }).click();
    await expect(ring(page)).toHaveAttribute('aria-valuenow', '70');
    await page.getByRole('button', { name: '辦理摘要' }).click();
    const dialog = page.getByRole('dialog', { name: '辦理摘要' });
    const text = dialog.getByLabel('摘要內容');
    await expect(text).toContainText('服務：住院醫療理賠');
    await expect(text).toContainText('NAVI 資料準備度 70%，非核賠結果');
    await expect(text).toContainText('官方來源：');
    await expect(text).not.toContainText('台中榮總');
    await dialog.getByRole('button', { name: '複製摘要' }).click();
    await expect(dialog.getByRole('button', { name: '已複製' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('服務：住院醫療理賠');
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '下載摘要' }).click();
    expect((await download).suggestedFilename()).toMatch(/^NAVI-辦理摘要-\d{4}-\d{2}-\d{2}\.txt$/);
  } finally { await backend.close(); }
});

test('資料與隱私: files are really deleted on the server; the journey is forgotten by this browser', async ({ page }) => {
  const backend = await formalBackend(page);
  try {
    await openJourney(page);
    await page.locator('[data-document="diagnosis_certificate"]').getByRole('button', { name: '使用合成範例（示範資料辨識）' }).click();
    await expect(ring(page)).toHaveAttribute('aria-valuenow', '70');
    const id = JSON.parse(await page.evaluate(() => localStorage.getItem('navi.journey'))).current;
    expect((await backend.server(`/api/journeys/${id}`)).documents).toHaveLength(1);

    await page.getByRole('button', { name: '資料與隱私' }).click();
    const dialog = page.getByRole('dialog', { name: '資料與隱私' });
    await expect(dialog).toContainText('不保存檔案本身');
    await expect(dialog).toContainText('1 小時後自動失效');
    await dialog.getByRole('button', { name: '移除已上傳的文件與資訊' }).click();
    await dialog.getByRole('button', { name: '確定移除' }).click();
    await expect(ring(page)).toHaveAttribute('aria-valuenow', '35');
    expect((await backend.server(`/api/journeys/${id}`)).documents).toHaveLength(0);
    await expect(dialog.getByRole('button', { name: '移除已上傳的文件與資訊' })).toBeDisabled();

    await dialog.getByRole('button', { name: '從這個瀏覽器移除這件事' }).click();
    await expect(dialog).toContainText('1 小時內自動失效');
    await dialog.getByRole('button', { name: '確定移除' }).click();
    await expect(page.locator('#story-input')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('navi.journey'))).toBeNull();
    await page.reload();
    await expect(page.getByRole('button', { name: '開啟工作區' })).toHaveCount(0);
  } finally { await backend.close(); }
});

test('任務列: one journey is removed from this browser after a confirmation; the other stays', async ({ page }) => {
  const backend = await formalBackend(page);
  try {
    await openJourney(page);
    await page.getByRole('button', { name: '回到 NAVI 首頁' }).click();
    await page.locator('#story-input').fill('我上個月在臺大醫院住院三天，想申請住院理賠'); await page.locator('#story-input').press('Enter');
    await page.getByRole('button', { name: '開啟工作區' }).last().click();
    const bar = page.getByRole('navigation', { name: '你的任務' });
    await expect(bar.locator('.task-chip')).toHaveCount(2);
    await bar.getByRole('button', { name: /從這個瀏覽器移除「住院醫療理賠・臺中榮民總醫院」/ }).click();
    await bar.getByRole('button', { name: '取消' }).click();
    await expect(bar.locator('.task-chip')).toHaveCount(2);
    await bar.getByRole('button', { name: /從這個瀏覽器移除「住院醫療理賠・臺中榮民總醫院」/ }).click();
    await bar.getByRole('button', { name: '從瀏覽器移除' }).click();
    await expect(page.locator('.task-chip')).toHaveCount(0);
    await expect(page.locator('.trip-strip strong').first()).toHaveText('臺大醫院');
  } finally { await backend.close(); }
});

test('phone: the privacy dialog and its actions fit without sideways scrolling', async ({ page }) => {
  const backend = await formalBackend(page);
  try {
    await openJourney(page, 390);
    await page.locator('summary[aria-label="更多選項"]').click();
    await page.getByRole('group', { name: '更多選項' }).getByRole('button', { name: '資料與隱私' }).click();
    await expect(page.getByRole('dialog', { name: '資料與隱私' }).getByRole('button', { name: '從這個瀏覽器移除這件事' })).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
  } finally { await backend.close(); }
});
