import { test, expect } from '@playwright/test';

// navi:mode: choosing 改用示範模式 inside NAVI switches the insurer site too, so demo mode then survives
// in-site navigation and a reload (NAVI-004). The site accepts the message only from the NAVI iframe, only
// demo / live, and does nothing when the mode is already the chosen one. Demo mode never calls the API.

const navi = page => page.frameLocator('iframe[title="NAVI 服務導航助手"]');
const frameMode = async page => new URL(await page.locator('iframe[title="NAVI 服務導航助手"]').getAttribute('src')).searchParams.get('mode');
const storedMode = page => page.evaluate(() => sessionStorage.getItem('navi.mode'));
const naviFrame = page => page.frames().find(frame => frame !== page.mainFrame() && new URL(frame.url()).pathname === '/embed');

async function openNavi(page) {
  const launcher = page.locator('[data-tour-id="navi-launcher"]');
  if (await launcher.isVisible()) await launcher.click();
  await expect(navi(page).getByText('嗨，我是 NAVI').first()).toBeVisible({ timeout: 30_000 });
}

for (const device of [{ name: 'desktop', viewport: { width: 1280, height: 860 } }, { name: 'phone', viewport: { width: 390, height: 844 } }]) {
  test(`改用示範模式 in NAVI is remembered by the site; only NAVI's own messages switch it — ${device.name}`, async ({ page, context }) => {
    await page.setViewportSize(device.viewport);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // The regular service with the AI unavailable: NAVI offers 改用示範模式.
    const api = [];
    await context.route('**/api/**', route => {
      api.push(route.request().url());
      return route.fulfill({ status: 503, headers: { 'Content-Type': 'application/json', 'X-NAVI-AI-Mode': 'live' }, body: JSON.stringify({ success: false, error: { code: 'AI_UNAVAILABLE', message: 'AI 分析服務暫時無法使用。', retryable: true } }) });
    });

    await page.goto('/');
    await openNavi(page);
    expect(await frameMode(page)).toBeNull();
    await navi(page).locator('#story-input').fill('我上週在台中榮總住院五天，要怎麼申請理賠？');
    await navi(page).locator('#story-input').press('Enter');
    await navi(page).getByRole('link', { name: '改用示範模式' }).last().click();

    // The site reloads NAVI in demo mode and remembers it for this tab.
    await expect.poll(() => frameMode(page)).toBe('demo');
    await openNavi(page);
    await expect(navi(page).locator('.mode-badge').first()).toHaveText(/示範/);
    expect(await storedMode(page)).toBe('demo');
    const before = api.length;
    await page.goto('/services/forms');
    await openNavi(page);
    expect(await frameMode(page)).toBe('demo');
    await page.reload();
    await openNavi(page);
    expect(await frameMode(page)).toBe('demo');
    expect(api.length).toBe(before);

    // A message from another window (here the site page itself) is ignored, whatever it says.
    await page.evaluate(() => window.postMessage({ source: 'navi', version: 1, type: 'navi:mode', mode: 'live' }, '*'));
    await page.waitForTimeout(500);
    expect(await frameMode(page)).toBe('demo');
    expect(await storedMode(page)).toBe('demo');

    // From NAVI itself: an unknown mode is ignored, the same mode does nothing, live switches back.
    const siteOrigin = new URL(page.url()).origin;
    await naviFrame(page).evaluate(origin => window.parent.postMessage({ source: 'navi', version: 1, type: 'navi:mode', mode: 'off' }, origin), siteOrigin);
    await naviFrame(page).evaluate(origin => window.parent.postMessage({ source: 'navi', version: 1, type: 'navi:mode', mode: 'demo' }, origin), siteOrigin);
    await page.waitForTimeout(500);
    expect(await frameMode(page)).toBe('demo');
    await naviFrame(page).evaluate(origin => window.parent.postMessage({ source: 'navi', version: 1, type: 'navi:mode', mode: 'live' }, origin), siteOrigin);
    await expect.poll(() => frameMode(page)).toBeNull();
    expect(await storedMode(page)).toBeNull();
    await page.reload();
    await openNavi(page);
    expect(await frameMode(page)).toBeNull();
    expect(errors).toEqual([]);
  });
}
