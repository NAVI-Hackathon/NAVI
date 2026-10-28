import { test, expect } from '@playwright/test';
import { createApp } from '../../apps/api/src/app.js';
import { createDemoProvider } from '../../apps/api/src/ai/demoProvider.js';
import { loadConfig } from '../../apps/api/src/config/env.js';

// A4 document handling against the real A client + real Express with the scripted demo provider (no AI call).
// `hold` delays a request (to see the real waiting states); `transform` edits a journey response (to show a
// server-reported conflict the demo data never produces).
async function formalBackend(page, { hold = () => 0, transform = data => data } = {}) {
  const config = { ...loadConfig({ AI_MODE: 'demo' }), rateLimit: 1000 };
  const server = createApp(config, createDemoProvider()).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`; let cookie;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const response = await fetch(base + new URL(request.url()).pathname, { method: request.method(), headers: { ...(cookie ? { Cookie: cookie } : {}), ...(request.headers()['content-type'] ? { 'Content-Type': request.headers()['content-type'] } : {}) }, ...(request.postDataBuffer() ? { body: request.postDataBuffer() } : {}) });
    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
    let body = await response.text();
    try { body = JSON.stringify(transform(JSON.parse(body), request)); } catch { /* not JSON */ }
    const wait = hold(request);
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    await route.fulfill({ status: response.status, headers: { 'Content-Type': 'application/json', 'X-NAVI-AI-Mode': response.headers.get('X-NAVI-AI-Mode') ?? 'demo' }, body }).catch(() => {});
  });
  return async () => { await page.unroute('**/api/**'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
}

const ring = page => page.locator('[role=progressbar][aria-label="準備完成度"]').first();
const card = (page, type) => page.locator(`[data-document="${type}"]`);
const isDocumentPost = request => request.method() === 'POST' && /\/api\/journeys\/[^/]+\/documents$/.test(new URL(request.url()).pathname);

async function openJourney(page, width) {
  await page.setViewportSize({ width, height: 900 }); await page.goto('/');
  await page.locator('#story-input').fill('我上週在台中榮總住院五天，要怎麼申請理賠？'); await page.locator('#story-input').press('Enter');
  await page.getByRole('button', { name: '開啟工作區' }).click();
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '35');
  if (width < 768) await page.getByRole('tab', { name: /文件/ }).click();
}

test('real waiting state, server-named requirements, removal needs a confirmation', async ({ page }) => {
  const close = await formalBackend(page, { hold: request => (isDocumentPost(request) ? 1500 : 0) });
  try {
    await openJourney(page, 1280);
    const certificate = card(page, 'diagnosis_certificate');
    // A demo server is said to be one: never presented as AI analysis (A8).
    await expect(page.getByRole('note').filter({ hasText: 'NAVI 服務目前以示範資料回答，不是 AI 分析' })).toBeVisible();
    await expect(page.locator('.mode-badge', { hasText: '示範資料' })).toBeVisible();
    await expect(page.getByText('由 AI 辨識')).toHaveCount(0);
    // Header text comes from the journey requirement, not a fixed percentage.
    await expect(certificate.getByRole('heading', { name: '診斷書或住院證明' })).toBeVisible();
    await expect(certificate).toContainText('必要');
    await expect(certificate).not.toContainText('+35%');

    await certificate.getByRole('button', { name: '使用合成範例（示範資料辨識）' }).click();
    // While the server reads the file there is no invented percentage, only the time actually waited.
    // (Real browsers first show 正在上傳 n% from XHR upload events; request interception here suppresses them.)
    const waiting = certificate.locator('.doc-analyzing');
    await expect(waiting).toContainText(/正在上傳並辨識文件…|正在以示範資料辨識…/);
    await expect(waiting).toContainText(/已等待 \d+ 秒，最長約 45 秒/);
    await expect(waiting).not.toContainText('%');
    await expect(ring(page)).toHaveAttribute('aria-valuenow', '70');
    await expect(certificate.getByRole('button', { name: /替換文件/ })).toBeVisible();

    await certificate.getByRole('button', { name: '移除診斷書或住院證明' }).click();
    await expect(certificate.getByRole('group', { name: '確認移除診斷書或住院證明' })).toBeVisible();
    await certificate.getByRole('button', { name: '取消' }).click();
    await expect(ring(page)).toHaveAttribute('aria-valuenow', '70');
    await certificate.getByRole('button', { name: '移除診斷書或住院證明' }).click();
    await certificate.getByRole('button', { name: '移除文件' }).click();
    await expect(ring(page)).toHaveAttribute('aria-valuenow', '35');
  } finally { await close(); }
});

test('phone: the documents tab shows the result and its actions without sideways scrolling', async ({ page }) => {
  const close = await formalBackend(page);
  try {
    await openJourney(page, 390);
    const certificate = card(page, 'diagnosis_certificate');
    await certificate.getByRole('button', { name: '使用合成範例（示範資料辨識）' }).click();
    await expect(certificate.getByRole('button', { name: /替換文件/ })).toBeVisible();
    await expect(certificate.getByRole('button', { name: '移除診斷書或住院證明' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally { await close(); }
});

test('a conflict the server reports is shown on the document, with ways to fix it', async ({ page }) => {
  const message = '診斷書上的醫院名稱與你描述的醫院不一致，請確認。';
  const close = await formalBackend(page, {
    transform: data => {
      const journey = data.journey ?? (data.documents ? data : null);
      const document = journey?.documents.find(d => d.documentType === 'diagnosis_certificate');
      if (document) {
        journey.consistencyIssues = [{ type: 'HOSPITAL_NAME_MISMATCH', severity: 'high', message, documentIds: [document.id] }];
        document.status = 'needs_review';
      }
      return data;
    },
  });
  try {
    await openJourney(page, 1280);
    const certificate = card(page, 'diagnosis_certificate');
    await certificate.getByRole('button', { name: '使用合成範例（示範資料辨識）' }).click();
    await expect(certificate.getByText(message)).toBeVisible();
    await expect(certificate.getByRole('button', { name: /替換文件/ })).toBeVisible();
    await expect(certificate.getByRole('button', { name: '先提供資訊（尚未驗證）' })).toBeVisible();
    await expect(certificate.getByRole('button', { name: /轉由專員協助/ })).toBeVisible();
  } finally { await close(); }
});

test('a replacement that cannot be read keeps the earlier document and says what to do instead', async ({ page }) => {
  const close = await formalBackend(page);
  try {
    await openJourney(page, 1280);
    const certificate = card(page, 'diagnosis_certificate');
    await certificate.getByRole('button', { name: '使用合成範例（示範資料辨識）' }).click();
    await expect(ring(page)).toHaveAttribute('aria-valuenow', '70');
    // This server only has demo recognition: the user's own file is never sent to it.
    const chooser = page.waitForEvent('filechooser');
    await certificate.getByRole('button', { name: /替換文件/ }).click();
    await (await chooser).setFiles({ name: 'my-certificate.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') });
    await expect(certificate.getByText('目前無法辨識上傳的文件')).toBeVisible();
    await expect(certificate.getByText('原本的文件仍保留，準備完成度沒有改變。')).toBeVisible();
    await expect(certificate.getByRole('button', { name: '用同一份文件再試一次' })).toHaveCount(0);
    await expect(ring(page)).toHaveAttribute('aria-valuenow', '70');
    await certificate.getByRole('button', { name: '保留原本的文件' }).click();
    await expect(certificate.getByRole('button', { name: /替換文件/ })).toBeVisible();
  } finally { await close(); }
});

test('a timeout offers the same file again only when asked, and the retry works', async ({ page }) => {
  let failOnce = true;
  const close = await formalBackend(page);
  try {
    // The first document request fails like a dropped connection; nothing is resent on its own.
    await page.route('**/api/journeys/*/documents', async route => {
      if (failOnce && route.request().method() === 'POST') { failOnce = false; await route.abort('failed'); return; }
      await route.fallback();
    });
    await openJourney(page, 1280);
    const certificate = card(page, 'diagnosis_certificate');
    await certificate.getByRole('button', { name: '使用合成範例（示範資料辨識）' }).click();
    await expect(certificate.getByText('這次沒有完成辨識')).toBeVisible();
    await expect(ring(page)).toHaveAttribute('aria-valuenow', '35');
    await certificate.getByRole('button', { name: '用同一份文件再試一次' }).click();
    await expect(ring(page)).toHaveAttribute('aria-valuenow', '70');
  } finally { await page.unroute('**/api/journeys/*/documents'); await close(); }
});
