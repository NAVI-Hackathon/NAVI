import { test, expect } from '@playwright/test';

// NAVI-004: once the user picks demo mode on the site (?navi=demo), NAVI stays in demo mode through the
// guide's in-site navigation, a reload, back / forward, closing and reopening, and links without the
// query; only ?navi=on chooses the regular service again. Demo mode never calls the NAVI API.

const navi = page => page.frameLocator('iframe[title="NAVI 服務導航助手"]');
const frameSrc = page => page.locator('iframe[title="NAVI 服務導航助手"]').getAttribute('src');

/** Open NAVI from the launcher and check that it really is demo mode: the URL and the visible badge. */
async function expectDemo(page) {
  // In-site back keeps an open panel open (client-side navigation); otherwise open it from the launcher.
  const launcher = page.locator('[data-tour-id="navi-launcher"]');
  if (await launcher.isVisible()) await launcher.click();
  await expect(navi(page).getByText('嗨，我是 NAVI').first()).toBeVisible({ timeout: 30_000 });
  expect(new URL(await frameSrc(page)).searchParams.get('mode')).toBe('demo');
  await expect(navi(page).locator('.mode-badge').first()).toHaveText(/示範/);
}

async function closeNavi(page) {
  await navi(page).getByRole('button', { name: '關閉 NAVI' }).click();
  await expect(page.locator('[data-tour-id="navi-launcher"]')).toBeVisible();
}

for (const device of [{ name: 'desktop', viewport: { width: 1280, height: 860 } }, { name: 'phone', viewport: { width: 390, height: 844 }, phone: true }]) {
  test(`F5: demo mode survives navigation, reload, back and reopening — ${device.name}`, async ({ page }) => {
    await page.setViewportSize(device.viewport);
    const api = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });

    await page.goto('/?navi=demo');
    await expectDemo(page);
    const input = navi(page).locator('#story-input');
    await input.fill('我搬家了，保單地址要怎麼改？');
    await input.press('Enter');
    await navi(page).getByRole('button', { name: /帶我去：查看變更戶籍地址/ }).last().click();
    await expect(page).toHaveURL(/\/services\/policy-change/);
    if (device.phone) await page.getByRole('button', { name: /回到 NAVI/ }).click();
    await navi(page).getByRole('button', { name: '下一步' }).click();
    await expect(page).toHaveURL(/\/services\/forms/);
    expect(new URL(page.url()).searchParams.get('navi')).toBeNull(); // the query is gone from the address

    await page.reload();
    await expectDemo(page);
    await page.goBack();
    await expect(page).toHaveURL(/\/services\/policy-change/);
    await expectDemo(page);
    await closeNavi(page);
    await expectDemo(page);
    await page.goto('/services/policy-loan');
    await expectDemo(page);
    expect(api).toEqual([]);

    // Choosing the regular service is explicit.
    await page.goto('/?navi=on');
    await page.locator('[data-tour-id="navi-launcher"]').click();
    expect(new URL(await frameSrc(page)).searchParams.get('mode')).toBeNull();
  });
}
