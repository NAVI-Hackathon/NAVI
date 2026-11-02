import { test, expect } from '@playwright/test';

// NAVI-012: on the mock insurer site the forms page says before any click that it only marks where a form
// is and provides no file, and every download button says 模擬 itself.
for (const device of [{ name: 'desktop', viewport: { width: 1280, height: 860 } }, { name: 'phone', viewport: { width: 390, height: 844 } }]) {
  test(`the simulated forms are labelled before the click — ${device.name}`, async ({ page }) => {
    await page.setViewportSize(device.viewport);
    await page.goto('/services/forms');
    await expect(page.getByRole('note').filter({ hasText: '這是模擬網站：表單只標示位置，不提供檔案下載。' })).toBeVisible();
    const downloads = page.getByRole('button', { name: /^下載/ });
    expect(await downloads.count()).toBeGreaterThan(0);
    for (const name of await downloads.allTextContents()) expect(name).toContain('（模擬）');
    await downloads.first().click();
    await expect(page.getByRole('status').filter({ hasText: '模擬網站不提供實際檔案，這裡只標示表單位置。' }).first()).toBeVisible();
  });
}
