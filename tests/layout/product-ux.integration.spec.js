import { test, expect } from '@playwright/test';
import { createApp } from '../../apps/api/src/app.js';
import { createDemoProvider } from '../../apps/api/src/ai/demoProvider.js';
import { loadConfig } from '../../apps/api/src/config/env.js';

// A7 product UX: network loss, two tabs on one journey, deep links, keyboard only, 200% zoom and text
// spacing, a long chat. Formal cases run the real A client against real Express (scripted demo provider,
// no AI call); routes sit on the browser context so every tab shares one server session.
async function formalBackend(context) {
  const config = { ...loadConfig({ AI_MODE: 'demo' }), rateLimit: 1000 };
  const server = createApp(config, createDemoProvider()).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`; let cookie;
  await context.route('**/api/**', async route => {
    const request = route.request();
    const response = await fetch(base + new URL(request.url()).pathname, { method: request.method(), headers: { ...(cookie ? { Cookie: cookie } : {}), ...(request.headers()['content-type'] ? { 'Content-Type': request.headers()['content-type'] } : {}) }, ...(request.postDataBuffer() ? { body: request.postDataBuffer() } : {}) });
    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
    await route.fulfill({ status: response.status, headers: { 'Content-Type': 'application/json', 'X-NAVI-AI-Mode': response.headers.get('X-NAVI-AI-Mode') ?? 'demo' }, body: await response.text() }).catch(() => {});
  });
  return async () => { await context.unroute('**/api/**'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
}

const ring = page => page.locator('[role=progressbar][aria-label="準備完成度"]').first();
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
async function ask(page, text) { await page.locator('#story-input').fill(text); await page.locator('#story-input').press('Enter'); }
async function openJourney(page, width = 1280) {
  await page.setViewportSize({ width, height: 900 }); await page.goto('/');
  await ask(page, '我上週在台中榮總住院五天，要怎麼申請理賠？');
  await page.getByRole('button', { name: '開啟工作區' }).click();
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '35');
}

test('network loss: NAVI says so, keeps what was typed, sends nothing; back online is announced', async ({ page, context }) => {
  const close = await formalBackend(context);
  try {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
    await context.setOffline(true);
    await expect(page.getByRole('status').filter({ hasText: '目前沒有網路連線' })).toBeVisible();
    await page.locator('#story-input').fill('我想改地址');
    await expect(page.getByRole('button', { name: '送出' })).toBeDisabled();
    await page.locator('#story-input').press('Enter');
    await expect(page.locator('#story-input')).toHaveValue('我想改地址');
    await expect(page.getByText('你輸入的內容會保留')).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText('已恢復連線，可以繼續操作。')).toBeVisible();
    await expect(page.getByRole('button', { name: '送出' })).toBeEnabled();
  } finally { await close(); }
});

test('two tabs on one journey: the other tab shows the server state when it is shown again', async ({ page, context }) => {
  const close = await formalBackend(context);
  try {
    await openJourney(page);
    // A duplicated tab carries the same sessionStorage (journey ids only).
    const stored = await page.evaluate(() => sessionStorage.getItem('navi.journey'));
    const other = await context.newPage();
    await other.addInitScript(value => { if (!sessionStorage.getItem('navi.journey')) sessionStorage.setItem('navi.journey', value); }, stored);
    await other.setViewportSize({ width: 1280, height: 900 }); await other.goto('/#workspace');
    await expect(ring(other)).toHaveAttribute('aria-valuenow', '35');
    await other.locator('[data-document="diagnosis_certificate"]').getByRole('button', { name: '使用合成範例（由 AI 辨識）' }).click();
    await expect(ring(other)).toHaveAttribute('aria-valuenow', '70');

    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(ring(page)).toHaveAttribute('aria-valuenow', '70');
    await expect(page.getByText('這件事在其他分頁有更新，已顯示最新狀態。')).toBeVisible();
  } finally { await close(); }
});

test('deep links: a stale #workspace, an unknown path, back and forward', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo#workspace');
  await expect(page.locator('#story-input')).toBeVisible(); // nothing to show: the chat, not an empty workspace
  await page.goto('/no-such-page');
  await expect(page.getByText('嗨，我是 NAVI')).toBeVisible();

  await page.goto('/demo');
  await ask(page, '我上週在台中榮總住院五天，要怎麼申請理賠？');
  await page.getByRole('button', { name: '開啟工作區' }).click();
  await expect(page).toHaveURL(/#workspace$/);
  await page.goBack();
  await expect(page.locator('#story-input')).toBeVisible();
  await page.goForward();
  await expect(ring(page)).toBeVisible();
  await page.reload();
  await expect(ring(page)).toBeVisible();
});

/** Press Tab until the focused element has this accessible name (keyboard only, no clicks). */
async function tabTo(page, name, { max = 80 } = {}) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => { const el = document.activeElement; return !el || el === document.body ? '' : (el.getAttribute('aria-label') || el.textContent || '').trim(); });
    if (typeof name === 'string' ? label === name : name.test(label)) return;
  }
  throw new Error(`Tab never reached ${name}`);
}
const focusRing = page => page.evaluate(() => {
  const style = getComputedStyle(document.activeElement);
  return (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
});

test('keyboard only: chat, guide, search and dialogs, with a visible focus and focus returned', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.addInitScript(() => { window.open = () => null; });
  await page.goto('/demo');
  await tabTo(page, '找服務');
  expect(await focusRing(page)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '找服務' })).toBeVisible();
  await page.keyboard.type('地址');
  await expect(page.getByText(/找到 \d 筆官網資料/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('找服務');

  await page.locator('#story-input').focus();
  await page.keyboard.type('我搬家了，保單地址要怎麼改？');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /帶我去：查看變更戶籍地址/ }).last()).toBeVisible();
  await tabTo(page, /帶我去：查看變更戶籍地址/);
  expect(await focusRing(page)).toBe(true);
  await page.keyboard.press('Enter');
  const guide = page.locator('.guide-card');
  await expect(guide).toBeVisible();
  await expect(guide.locator('.guide-title')).toBeFocused();
  await tabTo(page, /下一步/);
  await page.keyboard.press('Enter');
  await expect(page.getByText(/第 2 \/ \d 步/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);

  await page.locator('#story-input').focus();
  await page.keyboard.type('我上週在台中榮總住院五天，要怎麼申請理賠？');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '開啟工作區' }).last()).toBeVisible();
  await tabTo(page, /開啟工作區/);
  await page.keyboard.press('Enter');
  await expect(ring(page)).toBeVisible();
  await tabTo(page, /轉由專員接續/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.textContent)).toMatch(/轉由專員接續/);
});

for (const [name, setup] of [
  ['200% zoom (1280 × 800 at 2×)', async page => page.setViewportSize({ width: 640, height: 400 })],
  ['text spacing (WCAG 1.4.12)', async page => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }' });
  }],
]) test(`larger text: ${name} — nothing scrolls sideways, the main controls stay reachable`, async ({ page }) => {
  await page.goto('/demo');
  await setup(page);
  expect(await noSideScroll(page)).toBe(true);
  await ask(page, '我上週在台中榮總住院五天，要怎麼申請理賠？');
  await page.getByRole('button', { name: '開啟工作區' }).click();
  await expect(ring(page)).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  // The tabs (or panels) and the specialist entry are still on the page and usable.
  const specialist = page.getByRole('button', { name: /轉由專員接續/ }).first();
  await specialist.scrollIntoViewIfNeeded();
  await expect(specialist).toBeVisible();
  await page.getByRole('button', { name: '找服務' }).click();
  await expect(page.getByRole('searchbox', { name: '搜尋服務' })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
});

test('a long chat: after 30 messages the newest reply and the input are both in view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/demo');
  for (let i = 0; i < 15; i += 1) {
    await ask(page, i % 2 ? '理賠要準備什麼文件' : '我搬家了，保單地址要怎麼改？');
    await expect(page.locator('#story-input')).toBeEnabled();
  }
  await expect(page.locator('.chat-composer-box')).toBeInViewport();
  await expect(page.getByRole('log').locator(':scope *').last()).toBeInViewport({ ratio: 0.1 });
  expect(await noSideScroll(page)).toBe(true);
});

test('a request that never reaches NAVI says so and offers to try again (nothing is re-sent on its own)', async ({ page, context }) => {
  const close = await formalBackend(context);
  try {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
    let dropped = 0;
    await page.route('**/api/intelligence/**', route => { dropped += 1; return route.abort('failed'); });
    await ask(page, '我上週在台中榮總住院五天，要怎麼申請理賠？');
    await expect(page.getByRole('button', { name: '重新分析' })).toBeVisible();
    const before = dropped;
    await page.waitForTimeout(1500);
    expect(dropped).toBe(before);
    await page.unroute('**/api/intelligence/**');
    await page.getByRole('button', { name: '重新分析' }).click();
    await expect(page.getByRole('button', { name: '開啟工作區' })).toBeVisible();
  } finally { await close(); }
});
