import { test, expect } from '@playwright/test';

// Phone accessibility regression (/demo, local mock): through the main states — welcome, follow-up
// answer with its source open, step-by-step guide, workspace tabs, handoff dialog — every visible
// control is at least 36×36 px, has an accessible name, and nothing scrolls sideways (320 px is the
// reflow width that also stands in for enlarged text). Keyboard focus on the chat input is visible,
// and Escape closes a dialog.
const MIN = 36;

/** Problems on the current screen; checkboxes are measured by their label (the real tap target). */
const audit = () => {
  const problems = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) problems.push(`sideways scroll: ${document.documentElement.scrollWidth} > ${vw}`);
  const shown = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && r.bottom > 0 && r.top < innerHeight; };
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), textarea, select, summary')) {
    if (!shown(el) || el.closest('.visually-hidden') || el.classList.contains('visually-hidden') || el.classList.contains('skip-link')) continue;
    const box = ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label') ? el.closest('label') : el).getBoundingClientRect();
    const name = (el.getAttribute('aria-label') || el.textContent || el.labels?.[0]?.textContent || el.getAttribute('placeholder') || '').trim();
    const what = `<${el.tagName.toLowerCase()}> "${name.slice(0, 24)}"`;
    if (box.height < 36 || box.width < 36) problems.push(`${what} ${Math.round(box.width)}×${Math.round(box.height)}`);
    if (!name) problems.push(`${what} has no accessible name`);
  }
  return problems;
};

async function send(page, text) {
  const input = page.locator('#story-input');
  await input.fill(text);
  await input.press('Enter');
}

for (const width of [320, 390]) {
  test(`controls are large enough, named, and nothing scrolls sideways — ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
    await page.addInitScript(() => { window.open = () => null; });
    await page.goto('/demo');
    // Measured once entrance animations have settled (the workspace scales in from 98.5%).
    const check = async state => { await page.waitForTimeout(900); expect(await page.evaluate(audit), state).toEqual([]); };
    await check('welcome');

    await send(page, '理賠要準備什麼文件');
    await page.getByRole('button', { name: '醫療門診', exact: true }).click();
    await page.getByText('醫療門診理賠應備文件').last().waitFor();
    await page.locator('.source-toggle').last().click();
    await check('answer with source');

    await send(page, '我搬家了，保單上的地址要怎麼改？');
    await page.getByRole('button', { name: /帶我去：查看變更戶籍地址/ }).last().click();
    await page.locator('.guide-card').waitFor();
    await check('guide');
    await page.getByRole('button', { name: '結束導覽' }).click();

    await send(page, '我上週在台中榮總住院五天，要怎麼申請理賠？');
    await page.getByRole('button', { name: '開啟工作區' }).click();
    await check('workspace journey');
    for (const tab of [/文件/, /AI 助手/]) {
      await page.getByRole('tab', { name: tab }).click();
      await check(`workspace ${tab}`);
    }
    await page.getByRole('tab', { name: /旅程/ }).click();
    await page.getByRole('button', { name: /轉由專員接續/ }).first().click();
    await page.getByRole('dialog').waitFor();
    await check('handoff dialog');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('keyboard focus on the chat input shows a clear ring', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  const box = page.locator('.chat-composer-box');
  const before = await box.evaluate(el => getComputedStyle(el).borderColor);
  await page.locator('#story-input').focus();
  const after = await box.evaluate(el => ({ border: getComputedStyle(el).borderColor, shadow: getComputedStyle(el).boxShadow }));
  expect(after.border).not.toBe(before);
  expect(after.shadow).toContain('0.6');
});
