import { test, expect } from '@playwright/test';

// NAVI-006 (/demo, local mock): the workspace header, the 醫院與管道 step, the assistant and the documents
// say the same thing about the hospital at every stage — unknown → a certificate names it → replaced by
// another hospital → removed. A hospital on the 醫起通 list is never presented as eligibility.

const strip = page => page.locator('.trip-strip > div').first();
const hospitalStep = page => page.locator('.timeline .step').nth(1);
const fact = (page, label) => page.locator('.insight-facts > div').filter({ has: page.locator('dt').getByText(label, { exact: true }) }).locator('dd');

async function show(page, phone, tab) {
  if (phone) await page.getByRole('tab', { name: new RegExp(tab) }).click();
}

/** The four places, read in turn (on a phone each is on its own tab). */
async function expectHospital(page, phone, { name, label, partner }) {
  await show(page, phone, '旅程');
  await expect(strip(page).locator('strong')).toHaveText(name ?? '待確認');
  if (name) {
    await expect(hospitalStep(page).locator('.step-state')).toHaveText('已完成');
    await expect(hospitalStep(page).locator('.step-text')).toContainText(`住院醫院是「${name}」`);
    await expect(hospitalStep(page).locator('.step-text')).not.toContainText('還不知道');
    await expect(page.getByText('來自你的描述')).toHaveCount(0);
  } else {
    await expect(hospitalStep(page).locator('.step-state')).toHaveText('待確認');
    await expect(hospitalStep(page).locator('.step-text')).toContainText('還不知道住院的醫院');
  }

  await show(page, phone, 'AI 助手');
  await expect(fact(page, '住院醫院')).toHaveText(label ?? '待確認');
  await expect(fact(page, '醫起通')).toHaveText(partner);
  await expect(page.locator('.insight-origin')).toContainText('你一開始的需求：');

  await show(page, phone, '文件');
  const certificate = page.locator('.doc-card').filter({ hasText: '診斷書或住院證明' }).first();
  if (name) await expect(certificate).toContainText(name);
  await show(page, phone, '旅程');
}

for (const device of [{ name: 'phone', width: 390, phone: true }, { name: 'desktop', width: 1440, phone: false }]) {
  test(`the hospital reads the same everywhere: unknown → certificate → replaced → removed — ${device.name}`, async ({ page }) => {
    await page.setViewportSize({ width: device.width, height: 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/demo');
    await page.locator('#story-input').fill('我住院了，想申請理賠');
    await page.locator('#story-input').press('Enter');
    await page.getByRole('button', { name: '開啟工作區' }).click();
    await expectHospital(page, device.phone, { name: null, partner: '待確認醫院' });

    // A sample certificate names the hospital: on the 醫起通 list, still to be confirmed.
    await page.getByRole('button', { name: '使用範例文件' }).first().click();
    await expect(page.locator('[role=progressbar][aria-label="準備完成度"]').first()).toHaveAttribute('aria-valuenow', '70');
    await expectHospital(page, device.phone, { name: '臺中榮民總醫院', label: '臺中榮民總醫院（診斷書記載）', partner: '合作名單內・資格待確認' });
    await expect(hospitalStep(page).locator('.step-text')).toContainText('能否使用此管道仍需確認，請留意：');
    await show(page, device.phone, 'AI 助手');
    await expect(fact(page, '醫起通須確認')).toContainText('僅限合作醫療院所');
    await expect(page.getByText(/是醫起通合作醫院/)).toHaveCount(0);

    // Replaced by another hospital (entered by hand): every place follows.
    await show(page, device.phone, '文件');
    const certificate = page.locator('.doc-card').filter({ hasText: '診斷書或住院證明' }).first();
    await certificate.getByRole('button', { name: '移除診斷書或住院證明' }).click();
    await certificate.getByRole('button', { name: '移除文件' }).click();
    // /demo offers manual entry after a failed recognition (the demo control makes the next one fail).
    await page.locator('summary[aria-label="更多選項"]').click();
    await page.getByLabel('下一次文件辨識失敗').check();
    await page.keyboard.press('Escape');
    await certificate.getByRole('button', { name: '使用範例診斷書或住院證明' }).click();
    await certificate.getByRole('button', { name: '手動輸入' }).click();
    for (const [label, value] of [['病患姓名', '王小明'], ['醫院', '長庚醫院'], ['入院日期', '2026-09-28'], ['出院日期', '2026-10-02'], ['診斷', '示範']]) {
      await certificate.getByLabel(label, { exact: true }).fill(value);
    }
    await certificate.getByRole('button', { name: '確認內容' }).click();
    await expectHospital(page, device.phone, { name: '長庚醫院', label: '長庚醫院（診斷書記載）', partner: '未對應合作院所' });

    // Removed: back to unknown everywhere, the step no longer done.
    await show(page, device.phone, '文件');
    await certificate.getByRole('button', { name: '移除診斷書或住院證明' }).click();
    await certificate.getByRole('button', { name: '移除文件' }).click();
    await expectHospital(page, device.phone, { name: null, partner: '待確認醫院' });
    expect(errors).toEqual([]);
  });
}
