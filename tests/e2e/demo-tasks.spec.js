import { test, expect } from '@playwright/test';

// NAVI-005 / NAVI-010: the public demo (the site's ?navi=demo) handles the judge's C1 message as three
// tasks, offline. Each can be chosen; the others stay; answered ones can be read again; a journey is
// never opened twice; a reload of the tab brings the tasks and the journey back; a new tab starts empty
// (the scope the demo states). Demo mode never calls the NAVI API.

const C1 = '我想改通訊地址，另外還要準備住院理賠，順便找保險金申請書。';
const TASKS = ['我想改通訊地址', '另外還要準備住院理賠', '順便找保險金申請書'];
const SCOPE = '示範模式：任務只存在這個分頁，重新整理會保留，關閉分頁即清除，不會跨裝置。';

const navi = page => page.frameLocator('iframe[title="NAVI 服務導航助手"]');

async function openNavi(page) {
  const launcher = page.locator('[data-tour-id="navi-launcher"]');
  if (await launcher.isVisible()) await launcher.click();
  await expect(navi(page).getByText('嗨，我是 NAVI').first().or(navi(page).locator('[role=progressbar][aria-label="準備完成度"]').first())).toBeVisible({ timeout: 30_000 });
}

async function send(page, text) {
  const input = navi(page).locator('#story-input');
  await input.fill(text);
  await input.press('Enter');
}

// The task choices (the reply's own follow-up options are .chat-options too).
const choices = page => navi(page).getByRole('log').locator('.chat-options').filter({ hasText: /想先處理哪一件|件事，要接著處理嗎/ }).last().locator('.chat-option');
const taskBar = page => navi(page).locator('nav.task-bar').last();
const journeyChips = page => taskBar(page).locator('.task-chip:not(.is-open):not(.is-answered)');

for (const device of [{ name: 'desktop', viewport: { width: 1280, height: 860 } }, { name: 'phone', viewport: { width: 390, height: 844 } }]) {
  test(`C1: three tasks in the public demo — choose, switch, no duplicate journey, reload — ${device.name}`, async ({ page, context }) => {
    await page.setViewportSize(device.viewport);
    const api = [];
    context.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });

    await page.goto('/?navi=demo');
    await openNavi(page);
    await send(page, C1);
    const log = navi(page).getByRole('log');
    await expect(log.getByText('我聽到你有 3 件事')).toBeVisible();
    await expect(log.getByText('示範模式：依固定規則拆分需求，不是 AI 分析。')).toBeVisible();
    const options = choices(page);
    await expect(options).toHaveText(TASKS);

    // 1. The address: official answer; the other two stay offered.
    await options.filter({ hasText: TASKS[0] }).click();
    await expect(log.getByText('在官網資料中找到：').last()).toBeVisible();
    await expect(log.locator('.answer-card').last()).toContainText('變更戶籍地址');
    await expect(log.getByText('還有 2 件事，要接著處理嗎？')).toBeVisible();
    await expect(choices(page)).toHaveText([TASKS[1], TASKS[2]]);

    // 2. The claim form: official answer.
    await choices(page).filter({ hasText: TASKS[2] }).click();
    await expect(log.locator('.answer-card').last()).toContainText('保險金申請書');
    await expect(log.getByText('還有 1 件事，要接著處理嗎？')).toBeVisible();

    // 3. The hospital claim: a journey, then a document so it holds data.
    await choices(page).filter({ hasText: TASKS[1] }).click();
    await expect(log.getByText('已建立服務旅程')).toBeVisible();
    await expect(navi(page).getByRole('log').getByText(/件事，要接著處理嗎/)).toHaveCount(0); // nothing left to choose
    await expect(taskBar(page)).toContainText(SCOPE);
    await expect(taskBar(page).locator('.task-chip.is-answered')).toHaveCount(2);
    await log.getByRole('button', { name: '開啟工作區' }).last().click();
    const ring = navi(page).locator('[role=progressbar][aria-label="準備完成度"]').first();
    await expect(ring).toHaveAttribute('aria-valuenow', '35');
    await navi(page).getByRole('button', { name: '使用範例文件' }).click();
    await expect(ring).toHaveAttribute('aria-valuenow', '70');
    await expect(journeyChips(page)).toHaveCount(1);
    await expect(taskBar(page).locator('.task-chip.is-answered')).toHaveText([/我想改通訊地址.*已看官網說明/, /順便找保險金申請書.*已看官網說明/]);

    // A reload of the tab keeps the journey and the tasks (the chat itself is not kept).
    await page.reload();
    await openNavi(page);
    await expect(ring).toHaveAttribute('aria-valuenow', '70');
    await expect(journeyChips(page)).toHaveCount(1);
    await expect(taskBar(page).locator('.task-chip.is-answered')).toHaveText([/我想改通訊地址.*已看官網說明/, /順便找保險金申請書.*已看官網說明/]);
    await expect(taskBar(page)).toContainText(SCOPE);

    // Read an answered task again: back in the chat, its answer is shown; the journey is untouched.
    await taskBar(page).locator('.task-chip.is-answered').filter({ hasText: TASKS[0] }).click();
    await expect(log.locator('.answer-card').last()).toContainText('變更戶籍地址');

    // The same message again: choosing the hospital claim goes back to the same journey (still 70%).
    await send(page, C1);
    await choices(page).filter({ hasText: TASKS[1] }).click();
    await expect(navi(page).getByText('這件事已經有服務旅程，已切回原本那份，不會重複建立。')).toBeVisible();
    await log.getByRole('button', { name: '開啟工作區' }).last().click();
    await expect(ring).toHaveAttribute('aria-valuenow', '70');
    await expect(journeyChips(page)).toHaveCount(1);
    await expect(taskBar(page).locator('.task-chip.is-open')).toHaveText([/我想改通訊地址.*尚未處理/, /順便找保險金申請書.*尚未處理/]);

    // A new tab is another demo: nothing carried over.
    const other = await context.newPage();
    await other.setViewportSize(device.viewport);
    await other.goto('/?navi=demo');
    await openNavi(other);
    await expect(navi(other).getByText('嗨，我是 NAVI').first()).toBeVisible();
    await expect(navi(other).locator('nav.task-bar')).toHaveCount(0);
    await expect(navi(other).getByText(/件事，要接著處理嗎/)).toHaveCount(0);

    expect(api).toEqual([]);
  });
}
