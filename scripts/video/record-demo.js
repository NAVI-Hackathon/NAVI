// Records the 3-minute demo (docs/demo-script.md) on the live site as a silent screen video.
// Narration is recorded separately. Usage:
//   node scripts/video/record-demo.js                 # desktop, live VPS
//   SITE=http://127.0.0.1:3000 node scripts/video/record-demo.js   # local dev:all instead
// Output: artifacts/video/<timestamp>/demo-desktop.webm and .mp4 (+ key-frame PNGs for review). Git-ignored.
import { chromium } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';

const SITE = process.env.SITE ?? 'http://207.148.113.119';
const SIZE = { width: 1280, height: 720 };
const OUT = join('artifacts', 'video', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// A visible cursor and click ripple: headless recordings show no mouse, so viewers could not follow.
// It lives in the top page above the NAVI iframe and is moved by this script (iframe events never reach it).
const CURSOR_SCRIPT = () => {
  if (window.top !== window) return;
  addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `
      #demo-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; width: 22px; height: 22px; margin: -3px 0 0 -3px; pointer-events: none;
        transition: transform 650ms cubic-bezier(0.22, 0.61, 0.36, 1); filter: drop-shadow(0 2px 4px rgba(0,0,0,.45)); }
      #demo-ripple { position: fixed; z-index: 2147483646; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
        border: 3px solid #00915a; pointer-events: none; opacity: 0; }
      #demo-ripple.go { animation: demo-ripple 520ms ease-out; }
      @keyframes demo-ripple { from { opacity: .9; transform: scale(.4); } to { opacity: 0; transform: scale(1.4); } }`;
    document.head.append(style);
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l16 9-7 2-3 7z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    const ripple = document.createElement('div');
    ripple.id = 'demo-ripple';
    document.body.append(cursor, ripple);
    window.__demoCursor = {
      move(x, y) { cursor.style.transform = `translate(${x}px, ${y}px)`; },
      click(x, y) { ripple.style.left = `${x}px`; ripple.style.top = `${y}px`; ripple.classList.remove('go'); void ripple.offsetWidth; ripple.classList.add('go'); },
    };
    window.__demoCursor.move(innerWidth * 0.6, innerHeight * 0.6);
  });
};

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE }, locale: 'zh-TW' });
  await context.addInitScript(CURSOR_SCRIPT);
  const page = await context.newPage();
  const startedAt = Date.now(); // the video starts with the page
  const timeline = [];
  /** Mark where a section starts in the video (seconds), for writing the narration. */
  const mark = label => timeline.push({ at: Number(((Date.now() - startedAt) / 1000).toFixed(1)), label });
  let shot = 0;
  const frame = async name => page.screenshot({ path: join(OUT, `${String(++shot).padStart(2, '0')}-${name}.png`) });

  /** Glide the visible cursor to an element (also inside the NAVI iframe), then really click it. */
  async function click(locator, { hold = 250 } = {}) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Not visible: ${locator}`);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.evaluate(([px, py]) => window.__demoCursor?.move(px, py), [x, y]);
    await pause(700);
    await page.evaluate(([px, py]) => window.__demoCursor?.click(px, py), [x, y]);
    await page.mouse.click(x, y);
    await pause(hold);
  }
  async function hover(locator) {
    const box = await locator.boundingBox();
    if (box) await page.evaluate(([px, py]) => window.__demoCursor?.move(px, py), [box.x + box.width / 2, box.y + box.height / 2]);
    await pause(700);
  }

  // ── 0:00 痛點：官網資訊分散 ──
  mark('痛點：官網資訊分散');
  await page.goto(SITE);
  await pause(2500);
  await click(page.getByRole('link', { name: /理賠程序介紹/ }).first(), { hold: 2500 });
  await frame('claims-page');
  for (const tab of ['應備文件', '理賠聯盟鏈', '保險理賠醫起通']) await click(page.getByRole('tab', { name: tab }), { hold: 2200 });

  // ── 0:20 打開 NAVI ──
  mark('打開 NAVI');
  await click(page.getByRole('button', { name: /NAVI/ }).last(), { hold: 3500 });
  const navi = page.frameLocator('iframe[title="NAVI 服務導航助手"]');
  await navi.getByText('嗨，我是 NAVI').waitFor();
  await frame('navi-welcome');
  await pause(2500);

  const input = navi.locator('#story-input');
  async function ask(text, waitFor) {
    await click(input, { hold: 300 });
    await input.pressSequentially(text, { delay: 90 });
    await pause(600);
    await input.press('Enter');
    if (waitFor) await waitFor.waitFor({ timeout: 20_000 });
  }

  // ── 0:30 一、先問清楚（多輪）──
  mark('問：理賠要準備什麼文件');
  await ask('理賠要準備什麼文件', navi.getByText('你要申請哪一種？'));
  await pause(3000);
  await frame('follow-up-question');
  mark('NAVI 反問 → 選醫療門診');
  await click(navi.getByRole('button', { name: '醫療門診', exact: true }));
  await navi.getByText('醫療門診理賠應備文件').last().waitFor({ timeout: 20_000 });
  await pause(4000);
  mark('展開來源與原文');
  await click(navi.locator('.source-toggle').last(), { hold: 4500 });
  await frame('source-evidence');

  // ── 0:55 二、帶你去（地址變更）──
  mark('問：地址怎麼改');
  await ask('我搬家了，保單上的地址要怎麼改？', navi.getByRole('button', { name: /帶我去：查看變更戶籍地址/ }).last());
  await pause(3500);
  mark('導覽第 1 步');
  await click(navi.getByRole('button', { name: /帶我去：查看變更戶籍地址/ }).last(), { hold: 4500 });
  await frame('guide-step-1');
  await click(navi.getByRole('button', { name: '下一步' }), { hold: 4500 });
  await frame('guide-step-2');
  await click(navi.getByRole('button', { name: '下一步' }), { hold: 4500 });
  await frame('guide-step-3');
  await click(navi.getByRole('button', { name: '完成導覽' }), { hold: 2000 });

  // ── 1:25 三、護欄 ──
  mark('護欄：推薦保單');
  await ask('推薦我買哪張保單', navi.getByText('這個問題需要由專人協助'));
  await pause(5000);
  await frame('guardrail');

  // ── 1:35 四、住院理賠完整旅程 ──
  mark('回到理賠頁');
  // Bring the insurer site back to the claims page first (site links navigate client-side; NAVI keeps its chat).
  await click(page.getByRole('link', { name: /法國巴黎人壽/ }).first(), { hold: 1500 });
  await click(page.getByRole('link', { name: /理賠程序介紹/ }).first(), { hold: 2000 });
  /** Show the readiness ring (the panel may have scrolled down to the details). */
  const showReadiness = async () => {
    await navi.locator('.mobile-readiness-head').evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    await pause(2500);
  };
  mark('問：住院理賠');
  await ask('我上週在台中榮總住院五天，要怎麼申請理賠？', navi.getByRole('button', { name: '開啟工作區' }));
  await pause(3500);
  await frame('journey-card');
  mark('開啟工作區 35%');
  await click(navi.getByRole('button', { name: '開啟工作區' }), { hold: 3500 });
  await frame('workspace-35');
  mark('上傳範例診斷書 → 70%');
  await click(navi.getByRole('button', { name: '使用範例文件' }));
  await navi.getByText('70', { exact: true }).first().waitFor({ timeout: 20_000 });
  await showReadiness();
  await frame('workspace-70');
  mark('理賠文件健檢');
  await navi.locator('.preflight').scrollIntoViewIfNeeded();
  await hover(navi.locator('.preflight-earned').first());
  await pause(4000);
  await frame('preflight-70');
  await navi.locator('.mobile-readiness').scrollIntoViewIfNeeded();
  await pause(800);
  mark('帶我去：匯款給付規定');
  await click(navi.getByRole('button', { name: /帶我去：查看匯款給付規定/ }), { hold: 4500 });
  await frame('remittance-rule');
  mark('上傳範例存摺 → 90%');
  await click(navi.getByRole('button', { name: '使用範例文件' }));
  await navi.getByText('90', { exact: true }).first().waitFor({ timeout: 20_000 });
  await showReadiness();
  await frame('workspace-90');

  mark('確認資料 → 100%');
  await click(navi.getByRole('button', { name: '確認資料' }).first(), { hold: 2500 });
  for (const label of [/我已確認以上資料正確/, /我已下載並填妥/]) await click(navi.getByText(label), { hold: 700 });
  await click(navi.getByRole('dialog').getByRole('button', { name: '確認資料' }));
  await navi.getByText('100', { exact: true }).first().waitFor({ timeout: 20_000 });
  await showReadiness();
  await pause(1000);
  await frame('workspace-100');
  mark('前往服務入口');
  await click(navi.getByRole('button', { name: '前往服務入口' }).first(), { hold: 5000 });
  await frame('proceed');
  await click(navi.getByRole('button', { name: '完成導引' }), { hold: 1500 });

  // 交接（時間夠才保留在影片中）
  mark('交接摘要');
  await click(navi.getByRole('button', { name: /轉由專員接續/ }), { hold: 3500 });
  await click(navi.getByText(/同意取得交接摘要/), { hold: 800 });
  await click(navi.getByRole('button', { name: '確認並取得摘要' }), { hold: 4500 });
  await frame('handoff');

  // ── 2:52 結語 ──
  mark('結語');
  await click(navi.getByRole('dialog').getByRole('button', { name: '關閉' }), { hold: 1200 });
  await click(navi.getByRole('button', { name: '關閉 NAVI' }), { hold: 3000 });
  await frame('end');

  mark('影片結束');
  await context.close(); // finishes the video file
  await writeFile(join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 2));
  await browser.close();
  const video = (await readdir(OUT)).find(name => name.endsWith('.webm'));
  const webm = join(OUT, 'demo-desktop.webm');
  await rename(join(OUT, video), webm);
  // MP4 (H.264) plays everywhere and uploads to YouTube directly; skipped when ffmpeg is not installed.
  try {
    await promisify(execFile)('ffmpeg', ['-loglevel', 'error', '-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', webm.replace(/webm$/, 'mp4')]);
  } catch { console.warn('ffmpeg not available: kept the .webm only.'); }
  console.log(`Saved ${webm} (+ .mp4) and ${shot} key frames in ${OUT}.`);
}

main().catch(error => { console.error(error); process.exit(1); });
