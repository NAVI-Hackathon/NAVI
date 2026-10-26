import { test, expect } from '@playwright/test';
import snapshot from '../../data/cardif_public_data.json' with { type: 'json' };

for (const width of [375, 390, 430, 1280]) {
  test(`source panel shows the active knowledge version — ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let apiRequests = 0;
    await page.route('**/api/**', route => { apiRequests++; return route.abort(); });
    await page.goto('/demo');
    await page.getByRole('button', { name: '我搬家了，想改地址' }).click();
    const source = page.locator('.source-evidence').first();
    await source.locator('.source-toggle').click();
    await expect(source.getByText(`知識版本：${snapshot.meta.knowledgeVersion}`, { exact: true })).toBeVisible();
    await expect(source.locator('blockquote')).not.toBeEmpty();
    await expect(source.getByRole('link', { name: '開啟官網原頁' })).toHaveAttribute('href', /^https:\/\/life\.cardif\.com\.tw\//);
    expect(await source.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(apiRequests).toBe(0);
  });
}
