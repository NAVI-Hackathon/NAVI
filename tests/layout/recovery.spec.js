import { test, expect } from '@playwright/test';

// Error recovery and wording on a phone (/demo, local mock): a failed recognition started from 下一步 is
// reported where the user is, the score does not move, a retry works, and 100% reads as a preliminary
// preparation — never as an approval or a submission.
test.use({ viewport: { width: 390, height: 844 } });

const ring = page => page.locator('[role=progressbar][aria-label="準備完成度"]').first();

test('a failed upload says so and keeps the score; the retry works; 100% is preliminary and not submitted', async ({ page }) => {
  await page.goto('/demo');
  const input = page.locator('#story-input');
  await input.fill('我上週在台中榮總住院五天，要怎麼申請理賠？');
  await input.press('Enter');
  await page.getByRole('button', { name: '開啟工作區' }).click();
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '35');

  // The demo control makes the next recognition fail.
  await page.locator('summary[aria-label="更多選項"]').click();
  await page.getByLabel('下一次文件辨識失敗').check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '使用範例文件' }).click();
  await expect(page.locator('.toast-region')).toContainText('沒有完成辨識，準備完成度未改變');
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '35');

  // Retrying by hand works.
  await page.getByRole('button', { name: '使用範例文件' }).click();
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '70');
  await page.getByRole('button', { name: '使用範例文件' }).click();
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '90');

  await page.getByRole('button', { name: '確認資料' }).first().click();
  for (const label of [/我已確認以上資料正確/, /我已下載並填妥/]) await page.getByText(label).click();
  await page.getByRole('dialog').getByRole('button', { name: '確認資料' }).click();
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByText('已完成 NAVI 初步資料準備，仍需依正式規定確認與送件。').first()).toBeVisible();
  await expect(page.getByText('資料已準備完成')).toHaveCount(0);

  await page.getByRole('button', { name: '前往服務入口' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '已完成 NAVI 初步資料準備' })).toBeVisible();
  await expect(dialog).toContainText('資格待確認');
  await expect(dialog).toContainText('此管道可供查詢，實際適用資格仍需確認。');
  await expect(dialog).toContainText('尚未送件');
});
