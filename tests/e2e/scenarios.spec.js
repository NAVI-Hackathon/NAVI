import { test, expect } from '@playwright/test';

// Three cross-service journeys a first-time judge should complete, from plain language to the right
// place on the insurer site: (1) 住院理賠, (2) 地址變更, (3) finding a policy-service form.
// Each checks the site really navigates and outlines the target, and survives back / reload; desktop
// and phone. Demo mode: synthetic data, no backend, no Gemini.

const navi = page => page.frameLocator('iframe[title="NAVI 服務導航助手"]');

async function openNavi(page, path = '/') {
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}navi=demo`);
  await page.locator('[data-tour-id="navi-launcher"]').click();
  await expect(navi(page).getByText('嗨，我是 NAVI')).toBeVisible({ timeout: 30_000 });
}

async function ask(page, text) {
  const input = navi(page).locator('#story-input');
  await input.fill(text);
  await input.press('Enter');
}

/** The site outlined this target: the spotlight ring sits over the element carrying the data-tour-id. */
async function expectOutlined(page, anchor) {
  const target = page.locator(`[data-tour-id="${anchor}"]`);
  await expect(target).toBeVisible({ timeout: 15_000 });
  const spot = page.locator('.navi-spot');
  await expect(spot).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => {
    const [a, b] = [await target.boundingBox(), await spot.boundingBox()];
    if (!a || !b) return false;
    return b.x <= a.x + 2 && b.y <= a.y + 2 && b.x + b.width >= a.x + a.width - 2 && b.y + b.height >= a.y + a.height - 2;
  }, { message: `outline covers ${anchor}` }).toBe(true);
}

/** On phones NAVI folds away after taking the user somewhere; the launcher brings it back. */
async function backToNavi(page, phone) {
  if (!phone) return;
  await page.getByRole('button', { name: /回到 NAVI/ }).click();
}

for (const device of [{ name: 'desktop', viewport: { width: 1280, height: 860 }, phone: false }, { name: 'phone', viewport: { width: 390, height: 844 }, phone: true }]) {
  test.describe(device.name, () => {
    test.use({ viewport: device.viewport, ...(device.phone ? { hasTouch: true, isMobile: true } : {}) });

    test('地址變更: answer with its source → three-step guide on the site → back and reload', async ({ page }) => {
      await openNavi(page);
      await ask(page, '我搬家了，保單地址要怎麼改？');
      const go = navi(page).getByRole('button', { name: /帶我去：查看變更戶籍地址/ }).last();
      await expect(go).toBeVisible();
      await expect(navi(page).getByText(/依據：官網/).last()).toBeVisible();
      await go.click();
      await expect(page).toHaveURL(/\/services\/policy-change/);
      await expectOutlined(page, 'service-change-address');

      await backToNavi(page, device.phone);
      await expect(navi(page).getByText(/第 1／\d 步|1\s*\/\s*\d/).first()).toBeVisible();
      await navi(page).getByRole('button', { name: '下一步' }).click();
      await expect(page).toHaveURL(/\/services\/forms/);
      await expectOutlined(page, 'form-contract-change-investment');

      await backToNavi(page, device.phone);
      await navi(page).getByRole('button', { name: '下一步' }).click();
      await expect(page).toHaveURL(/\/services\/policy-change/);
      await backToNavi(page, device.phone);
      await navi(page).getByRole('button', { name: '完成導覽' }).click();

      // Back returns to the previous page of the site; a reload keeps the site working and NAVI reopens.
      await page.goBack();
      await expect(page).toHaveURL(/\/services\/forms/);
      await page.reload();
      await page.locator('[data-tour-id="navi-launcher"]').click();
      await expect(navi(page).getByText('嗨，我是 NAVI')).toBeVisible({ timeout: 30_000 });
    });

    test('表單查找: the contract change form is found and its row on the forms page is outlined', async ({ page }) => {
      await openNavi(page);
      await navi(page).getByRole('button', { name: '下載契約變更申請書' }).click();
      await expect(navi(page).getByText('保險契約內容變更申請書').first()).toBeVisible();
      await navi(page).getByRole('button', { name: /帶我去：下載保險契約內容變更申請書/ }).last().click();
      await expect(page).toHaveURL(/\/services\/forms/);
      await expectOutlined(page, 'form-contract-change-investment');
      // The outlined row's own button is not covered by the NAVI panel (it docks beside the page).
      const download = page.locator('[data-tour-id="form-contract-change-investment"]').getByRole('button', { name: '下載' });
      if (!device.phone) await expect.poll(() => download.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); })).toBe(true);
      else await backToNavi(page, false);
      await download.click();
      await expect(page.getByText('模擬網站不提供實際檔案')).toBeVisible();
    });

    test('住院理賠: journey 35 → 70 → 90 → 100, channels say what is still to confirm, the site shows the channel; reload resumes', async ({ page }) => {
      await openNavi(page, '/services/claims');
      await navi(page).getByRole('button', { name: '我住院了，想申請理賠' }).click();
      await navi(page).getByRole('button', { name: '開啟工作區' }).click();
      const ring = navi(page).locator('[role=progressbar][aria-label="準備完成度"]').first();
      await expect(ring).toHaveAttribute('aria-valuenow', '35');
      await expect(navi(page).getByText('NAVI 資料準備度，非核賠結果').first()).toBeVisible();

      await navi(page).getByRole('button', { name: '使用範例文件' }).click();
      await expect(ring).toHaveAttribute('aria-valuenow', '70');
      // In the site's panel NAVI uses the phone layout: the documents are on their own tab.
      await navi(page).getByRole('tab', { name: /文件/ }).click();
      await expect(navi(page).getByText(/示範模式・合成資料，非真實文件分析/).first()).toBeVisible();
      await expect(navi(page).getByText('欄位檢查通過').first()).toBeVisible();
      await navi(page).getByRole('tab', { name: /旅程/ }).click();

      // A reload of the insurer site keeps the journey: NAVI reopens on it.
      await page.reload();
      await page.locator('[data-tour-id="navi-launcher"]').click();
      await expect(navi(page).locator('[role=progressbar][aria-label="準備完成度"]').first()).toHaveAttribute('aria-valuenow', '70', { timeout: 30_000 });

      await navi(page).getByRole('button', { name: '使用範例文件' }).click();
      await expect(navi(page).locator('[role=progressbar][aria-label="準備完成度"]').first()).toHaveAttribute('aria-valuenow', '90');
      await navi(page).getByRole('button', { name: '確認資料' }).first().click();
      for (const label of [/我已確認以上資料正確/, /我已下載並填妥/]) await navi(page).getByText(label).click();
      await navi(page).getByRole('dialog').getByRole('button', { name: '確認資料' }).click();
      await expect(navi(page).locator('[role=progressbar][aria-label="準備完成度"]').first()).toHaveAttribute('aria-valuenow', '100');
      await expect(navi(page).getByText('已完成 NAVI 初步資料準備，仍需依正式規定確認與送件。').first()).toBeVisible();

      await navi(page).getByRole('button', { name: '前往服務入口' }).first().click();
      const dialog = navi(page).getByRole('dialog');
      await expect(dialog).toContainText('資格待確認');
      await expect(dialog).toContainText('此管道可供查詢，實際適用資格仍需確認。');
      await expect(dialog).not.toContainText('可申請');
      await dialog.getByRole('button', { name: /前往|查看/ }).first().click();
      await expect(page).toHaveURL(/\/services\/claims/);
      await expectOutlined(page, 'service-claim-hospital-upload');
    });
  });
}

test('public demo entry: /demo on the site goes to the demo NAVI entry (production redirect is in Nginx)', async ({ page }) => {
  // Locally the redirect is Nginx's job; the site itself must open NAVI in demo mode from ?navi=demo.
  await page.goto('/?navi=demo');
  await page.locator('[data-tour-id="navi-launcher"]').click();
  await expect(page.locator('iframe[title="NAVI 服務導航助手"]')).toHaveAttribute('src', /\/embed\?mode=demo/);
});
