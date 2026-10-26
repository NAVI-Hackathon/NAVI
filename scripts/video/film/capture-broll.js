// B-roll stills for the demo film: the mock insurer site and NAVI (demo mode, synthetic data),
// desktop 1920×1080 @2x and phone 390×844 @3x. Every shot is checked for layout breakage first.
// Usage:
//   node scripts/video/film/capture-broll.js               # live site (https://navitw.com)
//   SITE=http://127.0.0.1:3000 NAVI=http://127.0.0.1:5173 node scripts/video/film/capture-broll.js
// Output: artifacts/video/film/broll/{desktop,mobile}/NN-name.png + report.json (git-ignored).
import { chromium, devices } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SITE = (process.env.SITE ?? 'https://navitw.com').replace(/\/$/, '');
const NAVI = (process.env.NAVI ?? 'https://app.navitw.com').replace(/\/$/, '');
const OUT = join('artifacts', 'video', 'film', 'broll');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = [];

/** Layout checks run inside a page or frame: fonts, images, horizontal overflow, elements off-screen. */
const LAYOUT_CHECK = () => {
  const width = document.documentElement.clientWidth;
  const problems = [];
  if (document.documentElement.scrollWidth > width + 1) problems.push(`horizontal scroll: ${document.documentElement.scrollWidth} > ${width}`);
  for (const img of document.images) if (img.offsetParent && (!img.complete || img.naturalWidth === 0)) problems.push(`broken image: ${img.currentSrc || img.src}`);
  for (const el of document.body.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') continue;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    // Something wider than its clipping ancestor is fine; only report content that pokes out of the page.
    if (rect.right > width + 1 || rect.left < -1) {
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p);
        if (/(hidden|clip|auto|scroll)/.test(o.overflowX)) { clipped = true; break; }
      }
      if (!clipped) problems.push(`off-screen: <${el.tagName.toLowerCase()} class="${el.className}"> ${Math.round(rect.left)}–${Math.round(rect.right)}`);
    }
  }
  return { fontsReady: document.fonts.status === 'loaded', problems: problems.slice(0, 8) };
};

/** Toasts are transient and cover content: a still waits until none is showing. */
const noToast = target => target.waitForFunction(() => !document.querySelector('.toast-region > *'), null, { timeout: 9000 }).catch(() => {});

async function settle(page, frame = null) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle').catch(() => {});
  await noToast(page);
  if (frame) await noToast(frame);
  await pause(900); // entrance animations
}

/** Show a whole dialog's actions: scroll its scrollable body to the end. */
const dialogToEnd = page => page.getByRole('dialog').last().evaluate(dialog => {
  const body = [dialog, ...dialog.querySelectorAll('*')].find(n => n.scrollHeight > n.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(n).overflowY));
  if (body) body.scrollTop = body.scrollHeight;
});
const toTop = page => page.evaluate(() => { scrollTo(0, 0); document.querySelectorAll('main, .workspace').forEach(el => { el.scrollTop = 0; }); });

/**
 * `marks`: [label, locator] pairs. Their boxes (CSS px of the viewport, also inside the NAVI iframe) are saved
 * with the shot, so the film's outlines and captions land exactly on the real element.
 */
async function shot(page, dir, name, { frame = null, fullPage = false, marks = [] } = {}) {
  await settle(page, frame);
  const checks = [await page.evaluate(LAYOUT_CHECK)];
  if (frame) checks.push(await frame.evaluate(LAYOUT_CHECK));
  const problems = checks.flatMap(c => c.problems);
  const fontsReady = checks.every(c => c.fontsReady);
  const viewport = page.viewportSize();
  const boxes = [];
  for (const [label, locator] of marks) {
    const box = await locator.boundingBox().catch(() => null);
    const visible = Boolean(box) && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
    if (!visible) problems.push(`mark not fully on screen: ${label}`);
    boxes.push({ label, box });
  }
  const index = String(report.filter(r => r.dir === dir).length + 1).padStart(2, '0');
  const file = join(OUT, dir, `${index}-${name}.png`);
  await page.screenshot({ path: file, fullPage });
  report.push({ dir, name, file, viewport, scale: await page.evaluate(() => devicePixelRatio), marks: boxes, fontsReady, problems, ok: fontsReady && problems.length === 0 });
  console.log(`${problems.length || !fontsReady ? '✗' : '✓'} ${file}${problems.length ? `\n    ${problems.join('\n    ')}` : ''}`);
}

async function clickTab(page, name) {
  await page.getByRole('tab', { name }).click();
  await pause(500);
}

/** Open the embedded NAVI in demo mode on the current site page. */
async function openNavi(page) {
  await page.locator('[data-tour-id="navi-launcher"]').click();
  const navi = page.frameLocator('iframe[title="NAVI 服務導航助手"]');
  await navi.getByText('嗨，我是 NAVI').waitFor({ timeout: 20_000 });
  const frame = page.frames().find(f => f.url().includes('/embed'));
  return { navi, frame };
}

async function ask(navi, text, waitFor) {
  const input = navi.locator('#story-input');
  await input.click();
  await input.fill(text);
  await input.press('Enter');
  await waitFor.waitFor({ timeout: 20_000 });
  await pause(1400);
}

async function siteSet(browser, dir, contextOptions) {
  const context = await browser.newContext({ ...contextOptions, locale: 'zh-TW' });
  const page = await context.newPage();
  const mobile = dir === 'mobile';

  // The insurer site as a visitor first sees it.
  await page.goto(`${SITE}/`);
  await shot(page, dir, 'home');
  await shot(page, dir, 'home-full', { fullPage: true });
  await page.goto(`${SITE}/services`);
  await shot(page, dir, 'services');
  await page.goto(`${SITE}/services/forms`);
  await shot(page, dir, 'forms');

  // The claims page: the same information spread over several tabs (the pain point).
  await page.goto(`${SITE}/services/claims?navi=demo`);
  await shot(page, dir, 'claims', { marks: [['同一件事，拆在 5 個分頁', page.getByRole('tablist').first()]] });
  for (const [tab, name] of [['應備文件', 'claims-documents'], ['理賠聯盟鏈', 'claims-alliance'], ['保險理賠醫起通', 'claims-hospitals']]) {
    await clickTab(page, tab);
    await page.getByRole('tab', { name: tab }).scrollIntoViewIfNeeded();
    await shot(page, dir, name, { marks: name === 'claims-documents' ? [['17 類理賠，各有不同應備文件', page.getByRole('tab', { name: '應備文件' })]] : [] });
  }
  await page.goto(`${SITE}/services/claims?navi=demo`);
  await shot(page, dir, 'claims-full', { fullPage: true });

  // NAVI embedded in the site (demo mode: local synthetic data, no AI calls).
  const { navi, frame } = await openNavi(page);
  await shot(page, dir, 'navi-welcome', { frame, marks: mobile ? [] : [['NAVI 直接嵌在官網裡', page.locator('#navi-panel')]] });
  await ask(navi, '理賠要準備什麼文件', navi.getByText('你要申請哪一種？'));
  await shot(page, dir, 'navi-follow-up', { frame, marks: [['問題太籠統，先問清楚', navi.locator('.chat-option-list').last()]] });
  await navi.getByRole('button', { name: '醫療門診', exact: true }).click();
  await navi.getByText('醫療門診理賠應備文件').last().waitFor({ timeout: 20_000 });
  await pause(1200);
  await navi.locator('.source-toggle').last().click();
  await pause(1000);
  await shot(page, dir, 'navi-answer-source', { frame, marks: [['附官網原文與擷取日期', navi.locator('.source-panel').last()]] });

  // Step-by-step guide: the site follows each step and frames the target.
  await ask(navi, '我搬家了，保單上的地址要怎麼改？', navi.getByRole('button', { name: /帶我去：查看變更戶籍地址/ }).last());
  await shot(page, dir, 'navi-address-answer', { frame, marks: [['先給答案，一鍵開始導覽', navi.getByRole('button', { name: /帶我去：查看變更戶籍地址/ }).last()]] });
  await navi.getByRole('button', { name: /帶我去：查看變更戶籍地址/ }).last().click();
  for (let step = 1; step <= 3; step += 1) {
    await pause(2200);
    // Phones fold NAVI away so the highlighted place is visible; the launcher invites the user back.
    await shot(page, dir, `guide-step-${step}`, { frame, marks: [['官網跟著換頁、框出位置', page.locator('.navi-spot')], ...(mobile ? [] : [[`第 ${step}／3 步`, navi.locator('.guide-card')]])] });
    if (mobile) {
      await page.getByRole('button', { name: /回到 NAVI/ }).click();
      await pause(800);
      await shot(page, dir, `guide-step-${step}-card`, { frame, marks: [[`回到 NAVI，第 ${step}／3 步`, navi.locator('.guide-card')]] });
    }
    if (step < 3) await navi.getByRole('button', { name: '下一步' }).click();
  }
  await navi.getByRole('button', { name: '完成導覽' }).click();
  await pause(800);

  // Guardrail: no product advice.
  await ask(navi, '推薦我買哪張保單', navi.getByText('這個問題需要由專人協助'));
  await shot(page, dir, 'navi-guardrail', { frame, marks: [['不給投保建議，轉由專人協助', navi.getByText('這個問題需要由專人協助').last()]] });
  await context.close();
}

const ring = page => ['準備完成度由後端規則計分', page.locator('[role=progressbar][aria-label="準備完成度"]').locator('visible=true').first()];

/** The hospital journey in standalone NAVI /demo (wide three-column workspace on desktop). */
async function journeySet(browser, dir, contextOptions) {
  const context = await browser.newContext({ ...contextOptions, locale: 'zh-TW' });
  const page = await context.newPage();
  await page.goto(`${NAVI}/demo`);
  await settle(page);
  const input = page.locator('#story-input');
  await input.click();
  await input.fill('我上週在台中榮總住院五天，要怎麼申請理賠？');
  await input.press('Enter');
  await page.getByRole('button', { name: '開啟工作區' }).waitFor({ timeout: 20_000 });
  await pause(1200);
  await shot(page, dir, 'journey-card', { marks: [['一句話建立服務旅程', page.locator('article, section, div').filter({ has: page.getByRole('button', { name: '開啟工作區' }) }).last()]] });
  await page.getByRole('button', { name: '開啟工作區' }).click();
  await pause(1500);
  await shot(page, dir, 'workspace-35', { marks: [ring(page)] });
  const sample = () => page.getByRole('button', { name: /使用範例/ }).first().click();
  await sample();
  await page.getByText('70', { exact: true }).first().waitFor({ timeout: 20_000 });
  await pause(2200);
  await toTop(page);
  await shot(page, dir, 'workspace-70', { marks: [ring(page)] });
  if (dir === 'mobile') { await page.locator('.mobile-preflight').scrollIntoViewIfNeeded(); await pause(800); await shot(page, dir, 'workspace-preflight', { marks: [['缺什麼、為什麼、怎麼補', page.locator('.preflight').first()]] }); await toTop(page); }
  await sample();
  await page.getByText('90', { exact: true }).first().waitFor({ timeout: 20_000 });
  await pause(2200);
  await toTop(page);
  await shot(page, dir, 'workspace-90', { marks: [ring(page)] });
  await page.getByRole('button', { name: '確認資料' }).first().click();
  await pause(1000);
  for (const label of [/我已確認以上資料正確/, /我已下載並填妥/]) await page.getByText(label).click();
  await shot(page, dir, 'review-dialog', { marks: [['使用者確認資料後才進下一步', page.getByRole('dialog')]] });
  await page.getByRole('dialog').getByRole('button', { name: '確認資料' }).click();
  await page.getByText('100', { exact: true }).first().waitFor({ timeout: 20_000 });
  await pause(2400);
  await toTop(page);
  await shot(page, dir, 'workspace-100', { marks: [ring(page)] });
  await page.getByRole('button', { name: /轉由專員接續/ }).first().click();
  await pause(1000);
  await page.getByText(/同意取得交接摘要/).click();
  await page.getByRole('button', { name: '確認並取得摘要' }).click();
  await pause(2000);
  if (dir === 'mobile') await shot(page, dir, 'handoff-top');
  await dialogToEnd(page);
  await shot(page, dir, 'handoff', { marks: [['確認後才取得摘要・尚未送出', page.getByText(/已取得交接摘要/).last()]] });
  await context.close();
}

async function main() {
  for (const dir of ['desktop', 'mobile']) await mkdir(join(OUT, dir), { recursive: true });
  const browser = await chromium.launch();
  const desktop = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 };
  const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
  const mobile = { ...iphone, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 };
  try {
    await siteSet(browser, 'desktop', desktop);
    await journeySet(browser, 'desktop', desktop);
    await siteSet(browser, 'mobile', mobile);
    await journeySet(browser, 'mobile', mobile);
  } finally {
    await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
  const bad = report.filter(r => !r.ok);
  console.log(`\n${report.length} shots, ${bad.length} with layout problems.`);
  if (bad.length) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exit(1); });
