import { test, expect } from '@playwright/test';

// A6 (/demo, local mock). NAVI-011: a failed recognition is explained in Traditional Chinese — no error
// code — the score does not move, and the same file can be tried again (review E9 / E10).
// NAVI-019: nothing on a phone is smaller than 12px, the mode badge stays on one line, and the page never
// scrolls sideways, down to 320px wide.

const RAW = /[A-Z]{2,}_[A-Z_]+|Error:/;
const ring = page => page.locator('[role=progressbar][aria-label="準備完成度"]').first();

async function openWorkspace(page) {
  await page.goto('/demo');
  await page.locator('#story-input').fill('我上週在台中榮總住院五天，要怎麼申請理賠？');
  await page.locator('#story-input').press('Enter');
  await page.getByRole('button', { name: '開啟工作區' }).click();
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '35');
}

/** Visible text smaller than `min` px: one entry per class, with an example. */
const textBelow = (page, min) => page.evaluate(limit => {
  const found = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const element = node.parentElement;
    if (!node.textContent.trim() || !element || element.closest('[aria-hidden="true"], .skip-link, svg')) continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || getComputedStyle(element).visibility === 'hidden') continue;
    const size = parseFloat(getComputedStyle(element).fontSize);
    const key = `${element.tagName.toLowerCase()}.${element.className} ${size}px`;
    if (size < limit && !found.has(key)) found.set(key, node.textContent.trim().slice(0, 20));
  }
  return [...found].map(([where, text]) => `${where}: ${text}`);
}, min);

for (const width of [375, 390]) {
  test(`a failed recognition reads in Chinese and can be retried; text is 12px or more — ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openWorkspace(page);

    await page.locator('summary[aria-label="更多選項"]').click();
    await page.getByLabel('下一次文件辨識失敗').check();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '使用範例文件' }).click();
    await expect(page.locator('.toast-region')).toContainText('沒有完成辨識，準備完成度未改變');
    await expect(page.locator('.toast-region')).not.toContainText(RAW);
    await page.getByRole('tab', { name: /文件/ }).click(); // on a phone the card is on its own tab
    const failed = page.locator('.doc-failed').first();
    await expect(failed).toContainText('這次沒有辨識出文件內容');
    await expect(failed).toContainText('準備完成度沒有改變');
    await expect(failed).not.toContainText(RAW);
    await expect(page.locator('body')).not.toContainText(RAW);
    await failed.getByRole('button', { name: '用同一份文件再試一次' }).click();
    await expect(page.locator('.toast-region')).toContainText('準備度已更新');
    await page.getByRole('tab', { name: /旅程/ }).click();
    await expect(ring(page)).toHaveAttribute('aria-valuenow', '70');

    for (const tab of ['旅程', 'AI 助手', '文件']) {
      const control = page.getByRole('tab', { name: new RegExp(tab) });
      await control.click();
      await expect(page.locator('#' + await control.getAttribute('aria-controls'))).toBeVisible();
      expect(await textBelow(page, 12), tab).toEqual([]);
    }
  });
}

test('the mode badge stays on one line and nothing scrolls sideways, down to 320px', async ({ page }) => {
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await openWorkspace(page);
    const badge = page.locator('.mode-badge').first();
    await expect(badge).toBeVisible();
    const { height, line } = await badge.evaluate(el => ({ height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.6 }));
    expect(height, `badge at ${width}px`).toBeLessThan(line * 1.9);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `width ${width}`).toBeLessThanOrEqual(0);
  }
});

test('the subtitle is the short Chinese one on a phone, on one line; the desktop keeps the English one', async ({ page }) => {
  for (const [width, text] of [[320, '智慧保險導引'], [390, '智慧保險導引'], [1280, 'AI Service Journey Navigator']]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/demo');
    const subtitle = page.locator('.app-header .wordmark small:visible');
    await expect(subtitle, `${width}px`).toHaveCount(1);
    await expect(subtitle).toHaveText(text);
    const { height, line } = await subtitle.evaluate(el => ({ height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.4 }));
    expect(height, `subtitle at ${width}px`).toBeLessThan(line * 1.9);
  }
});

test('with a journey open, every header button stays on screen from 320px to 1280px (J-04)', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: '回到 NAVI 首頁' }).click();
  const resume = page.locator('.app-header').getByRole('button', { name: '回到我的旅程' });
  for (const width of [320, 375, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(resume, `${width}px`).toBeVisible();
    const boxes = await page.locator('.app-header-inner').evaluate(inner => [...inner.querySelectorAll('button, summary')]
      .filter(el => !el.closest('.menu-popover'))
      .map(el => { const r = el.getBoundingClientRect(); return { name: el.getAttribute('aria-label') || el.textContent.trim(), left: r.left, right: r.right }; }));
    for (const box of boxes) {
      expect(box.left, `${box.name} at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${box.name} at ${width}px`).toBeLessThanOrEqual(width);
    }
  }
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator('.app-header summary[aria-label="更多選項"]').click();
  await expect(page.locator('.menu-popover').getByRole('button', { name: '資料與隱私' })).toBeVisible();
  await resume.click();
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '35');
});

test('formal mode: the header says AI analysis with synthetic data, and it stays on screen from 320px to 1280px (J-16)', async ({ page }) => {
  await page.goto('/');
  const badge = page.locator('.app-header .mode-badge-ai');
  await expect(badge).toHaveAttribute('title', '會把你的描述送到 AI 分析；請只用合成資料');
  for (const [width, text] of [[320, 'AI'], [375, 'AI'], [390, 'AI'], [430, 'AI'], [768, 'AI 分析・合成資料'], [1280, 'AI 分析・合成資料']]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(badge, `${width}px`).toBeVisible();
    const shown = await badge.evaluate(el => [...el.children].find(c => getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().width > 1)?.textContent);
    expect(shown, `${width}px`).toBe(text);
    const boxes = await page.locator('.app-header-inner').evaluate(inner => [...inner.querySelectorAll('button, summary, .mode-badge')]
      .filter(el => !el.closest('.menu-popover'))
      .map(el => { const r = el.getBoundingClientRect(); return { name: el.getAttribute('aria-label') || el.textContent.trim(), left: r.left, right: r.right, top: r.top }; }));
    for (const box of boxes) {
      expect(box.left, `${box.name} at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${box.name} at ${width}px`).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `width ${width}`).toBeLessThanOrEqual(0);
  }
  await expect(page.locator('.app-header .mode-badge', { hasText: '示範' })).toHaveCount(0);
});

test('desktop: explanations of mode, sources and limits are 13px; nothing is below 11px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);
  for (const selector of ['.demo-banner', '.step-text']) {
    expect(await page.locator(selector).first().evaluate(el => parseFloat(getComputedStyle(el).fontSize)), selector).toBeGreaterThanOrEqual(13);
  }
  expect(await textBelow(page, 11)).toEqual([]);
});
