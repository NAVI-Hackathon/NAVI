import { test, expect } from '@playwright/test';

// Regression for the mobile Guided Action bug (23259f3): after scrolling the chat, the guide card
// covered the chat input. Checks real coordinates — not just that the elements exist — at every
// guide step, with the conversation scrolled to the top, middle and bottom.
const SIZES = [
  { name: '375x812', width: 375, height: 812 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  // Visible height with the on-screen keyboard open (the layout follows the visual viewport).
  { name: '390x544 keyboard', width: 390, height: 544 },
  { name: '375x460 small keyboard', width: 375, height: 460 },
];

/** Overlap, visibility and real clickability (the element under the centre point is the control). */
async function measure(page) {
  return page.evaluate(() => {
    const box = selector => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const clickable = selector => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const r = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    };
    const guide = box('.guide-card');
    const input = box('.chat-composer-box');
    return {
      overlap: guide && input ? Math.max(0, Math.min(guide.bottom, input.bottom) - Math.max(guide.top, input.top)) : 0,
      inputVisible: Boolean(input) && input.top >= 0 && input.bottom <= window.innerHeight,
      guideVisible: Boolean(guide) && guide.top >= 0 && guide.bottom <= window.innerHeight,
      pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
      next: clickable('.guide-next'),
      close: clickable('.guide-close'), send: clickable('.chat-send'), field: clickable('#story-input'),
    };
  });
}

async function scrollThread(page, position) {
  await page.evaluate(where => {
    // Scroll both the chat and the page, as a finger would: whichever one actually scrolls.
    const thread = document.querySelector('.chat-thread');
    const page = document.scrollingElement;
    for (const scroller of [thread, page]) {
      scroller.scrollTop = where === 'top' ? 0 : where === 'middle' ? (scroller.scrollHeight - scroller.clientHeight) / 2 : scroller.scrollHeight;
    }
  }, position);
}

for (const size of SIZES) {
  test(`guide card never covers the chat input — ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.addInitScript(() => { window.open = () => null; }); // standalone 帶我去 would open the insurer site
    await page.goto('/demo');

    await page.getByRole('button', { name: '我搬家了，想改地址' }).click();
    await page.getByRole('button', { name: /帶我去：查看變更戶籍地址/ }).click();
    const guide = page.locator('.guide-card');
    await expect(guide).toBeVisible();

    const total = 2; // service information → linked form; no redundant return to the first destination
    for (let step = 1; step <= total; step += 1) {
      await expect(page.locator('.guide-count')).toHaveText(`第 ${step} / ${total} 步`);
      await page.waitForTimeout(400); // let the step transition settle before measuring
      for (const position of ['top', 'middle', 'bottom']) {
        await scrollThread(page, position);
        const m = await measure(page);
        const where = `step ${step}, chat scrolled to ${position}`;
        // Soft checks: one run reports every broken position, not only the first.
        expect.soft(m.overlap, `${where}: guide card overlaps the input`).toBe(0);
        expect.soft(m.inputVisible, `${where}: input not fully on screen`).toBe(true);
        expect.soft(m.guideVisible, `${where}: guide card cut off`).toBe(true);
        expect.soft(m.pageScrolls, `${where}: the whole page scrolls (only the thread should)`).toBe(false);
        for (const control of ['next', 'close', 'send', 'field']) expect.soft(m[control], `${where}: ${control} not clickable`).toBe(true);
      }
      if (step < total) await page.locator('.guide-next').click();
    }

    // 上一步 goes back and 完成導覽 ends the guide; the input stays usable afterwards.
    await page.getByRole('button', { name: '上一步' }).click();
    await expect(page.locator('.guide-count')).toHaveText(`第 ${total - 1} / ${total} 步`);
    await page.locator('.guide-close').click();
    await expect(guide).toHaveCount(0);
    await page.locator('#story-input').fill('門診理賠要什麼文件');
    await expect(page.locator('.chat-send')).toBeEnabled();
  });
}
