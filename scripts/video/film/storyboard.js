// Storyboard stills for the demo film: each scene is a B-roll screenshot (capture-broll.js) in a desktop
// browser or phone frame, with the real element outlined, a label beside it and a caption. 1920×1080.
// Usage: node scripts/video/film/storyboard.js   (after capture-broll.js)
// Output: artifacts/video/film/storyboard/NN-scene.png + storyboard.png (contact sheet). Git-ignored.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BROLL = join('artifacts', 'video', 'film', 'broll');
const OUT = join('artifacts', 'video', 'film', 'storyboard');
const W = 1920, H = 1080;

// time: where the scene starts in the film (100 BPM, 2.4 s a bar); section: the eyebrow; caption: one line to read.
const SCENES = [
  { time: '0:00', section: '產品概念', card: 'concept' },
  { time: '0:12', section: '01　痛點', caption: '資訊都在，卻散在不同分頁', shots: [['desktop', 'claims']] },
  { time: '0:17', section: '01　痛點', caption: '看完還是不確定要準備什麼', shots: [['desktop', 'claims-documents']] },
  { time: '0:24', section: '02　遇見 NAVI', caption: '不用離開官網，說出你的情況', shots: [['desktop', 'navi-welcome']] },
  { time: '0:29', section: '02　核心介面', card: 'interfaces' },
  { time: '0:38', section: '03　理解', caption: '問得太籠統？先問清楚', shots: [['desktop', 'navi-follow-up']] },
  { time: '0:46', section: '03　理解', caption: '每個答案都能追溯官網原文', shots: [['desktop', 'navi-answer-source']] },
  { time: '0:55', section: '04　帶你去', caption: '一步一步帶到正確位置', shots: [['desktop', 'guide-step-1']] },
  { time: '1:00', section: '04　帶你去', caption: '官網跟著換頁、框出目標', shots: [['desktop', 'guide-step-2']] },
  { time: '1:05', section: '04　帶你去', caption: '手機也一樣順', shots: [['desktop', 'guide-step-3', { marks: false }], ['mobile', 'guide-step-3-card']] },
  { time: '1:12', section: '05　檢核', caption: '一句話建立住院理賠旅程', shots: [['mobile', 'journey-card'], ['desktop', 'workspace-35', { marks: false }]] },
  { time: '1:20', section: '05　檢核', caption: '上傳診斷書，準備度 70%', shots: [['mobile', 'workspace-70']] },
  { time: '1:25', section: '05　檢核', caption: '缺什麼、為什麼、怎麼補', shots: [['mobile', 'workspace-preflight']] },
  { time: '1:31', section: '05　檢核', caption: '資料準備完成 100%', shots: [['desktop', 'workspace-100']] },
  { time: '1:36', section: '06　可信', caption: '不給投保建議，不判斷能否理賠', shots: [['desktop', 'navi-guardrail']] },
  { time: '1:41', section: '06　可信', caption: '需要真人時，確認後才取得摘要', shots: [['mobile', 'handoff']] },
  { time: '1:46', section: '', card: 'logo' },
];

const CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { width: ${W}px; height: ${H}px; overflow: hidden; font-family: 'Noto Sans TC', 'PingFang TC', sans-serif; color: #EEEFE9;
    background: radial-gradient(1200px 700px at 70% 20%, #16201C 0%, #0A0B0D 60%); }
  .badge { position: absolute; top: 44px; right: 56px; font-size: 22px; letter-spacing: 2px; color: #97C9B3; border: 1px solid #97C9B355; border-radius: 999px; padding: 8px 18px; }
  .time { position: absolute; top: 44px; left: 56px; font: 600 22px 'DM Sans', sans-serif; color: #5E6A64; letter-spacing: 2px; }
  .caption { position: absolute; left: 96px; bottom: 72px; }
  .caption .section { font-size: 24px; letter-spacing: 6px; color: #97C9B3; margin-bottom: 14px; }
  .caption .line { font-size: 56px; font-weight: 700; letter-spacing: 1px; }
  .stage { position: absolute; inset: 104px 96px 210px; display: flex; gap: 56px; align-items: center; justify-content: center; }
  .device { position: relative; flex: none; }
  .browser { border-radius: 18px; overflow: hidden; background: #0F1113; box-shadow: 0 40px 120px #000c, 0 0 0 1px #ffffff14; }
  .browser .bar { height: 40px; display: flex; align-items: center; gap: 10px; padding: 0 18px; background: #1A1D20; }
  .browser .bar i { width: 12px; height: 12px; border-radius: 50%; background: #3A3F44; display: block; }
  .browser .bar span { margin-left: 18px; font: 18px 'DM Sans', sans-serif; color: #8D969B; background: #0F1113; border-radius: 8px; padding: 4px 16px; }
  .phone { border-radius: 58px; padding: 14px; background: #1B1E21; box-shadow: 0 40px 120px #000c, inset 0 0 0 2px #2C3135; }
  .phone .screen { border-radius: 46px; overflow: hidden; position: relative; }
  .phone .notch { position: absolute; top: 12px; left: 50%; width: 120px; height: 34px; margin-left: -60px; border-radius: 20px; background: #000; z-index: 2; }
  .shot { display: block; position: relative; }
  .shot img { display: block; width: 100%; height: 100%; }
  .dim { position: absolute; inset: 0; }
  .ring { position: absolute; border: 4px solid #00B26E; border-radius: 14px; box-shadow: 0 0 0 6px #00B26E33, 0 0 40px #00B26E66; }
  .label { position: absolute; z-index: 5; max-width: 520px; font-size: 30px; font-weight: 700; line-height: 1.35; color: #0A0B0D; background: #EEEFE9; border-radius: 14px; padding: 14px 22px; box-shadow: 0 12px 40px #0008; white-space: nowrap; }
  .label::before { content: ''; position: absolute; width: 14px; height: 14px; border-radius: 50%; background: #00B26E; box-shadow: 0 0 0 5px #00B26E44; }
  .label.right::before { left: -38px; top: 50%; margin-top: -7px; }
  .label.left::before { right: -38px; top: 50%; margin-top: -7px; }
  .label.below::before { left: 26px; top: -34px; }
  .label.above::before { left: 26px; bottom: -34px; }
  .card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 28px; }
  .mark-logo { width: 150px; height: 150px; border-radius: 40px; background: #EEEFE9; display: grid; place-items: center; }
  .name { font: 700 140px 'DM Sans', sans-serif; letter-spacing: 28px; margin-right: -28px; }
  .tag { font-size: 40px; letter-spacing: 14px; color: #97C9B3; }
  .sub { font-size: 30px; color: #8D969B; letter-spacing: 2px; }
  .tiles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 28px; width: 1680px; margin-top: 20px; }
  .tile { display: flex; flex-direction: column; gap: 16px; align-items: center; }
  .tile .pic { width: 100%; height: 520px; border-radius: 22px; overflow: hidden; background: #0F1113; box-shadow: 0 0 0 1px #ffffff1a; }
  .tile .pic img { width: 100%; height: 100%; object-fit: cover; object-position: top; }
  .tile b { font-size: 30px; } .tile small { font-size: 22px; color: #8D969B; }
`;

const LOGO = '<svg viewBox="0 0 40 40" width="96" height="96"><path d="M11 29V20h9v-9h9m-5 0h5v5" fill="none" stroke="#0a0b0d" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function deviceHtml(entry, [kind, name, options = {}], maxW, maxH) {
  const src = pathToFileURL(resolve(entry.file)).href;
  const vw = entry.viewport.width, vh = entry.viewport.height;
  const chrome = kind === 'desktop' ? 40 : 28;
  const scale = Math.min(maxW / vw, (maxH - chrome) / vh);
  const w = Math.round(vw * scale), h = Math.round(vh * scale);
  const marks = options.marks === false ? [] : entry.marks.filter(m => m.box);
  const rings = marks.map((m, i) => {
    const b = m.box, pad = 10;
    const x = b.x * scale - pad, y = b.y * scale - pad, bw = b.width * scale + pad * 2, bh = b.height * scale + pad * 2;
    return { i, x, y, w: bw, h: bh, label: m.label };
  });
  // The rest of the screen dims; each outlined element stays bright (SVG mask cut-outs).
  const dim = rings.length ? `<svg class="dim" width="${w}" height="${h}"><defs><mask id="m-${name}"><rect width="100%" height="100%" fill="white"/>${rings.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="14" fill="black"/>`).join('')}</mask></defs><rect width="100%" height="100%" fill="#05070699" mask="url(#m-${name})"/></svg>` : '';
  const ringHtml = rings.map(r => `<div class="ring" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"></div><div class="label" data-ring='${JSON.stringify(r)}'>${r.label}</div>`).join('');
  const shot = `<div class="shot" style="width:${w}px;height:${h}px"><img src="${src}">${dim}${ringHtml}</div>`;
  if (kind === 'desktop') {
    const path = { 'navi-welcome': '/services/claims', claims: '/services/claims', 'claims-documents': '/services/claims' }[name] ?? (name.startsWith('guide') || name.startsWith('navi') ? '/services/policy-change' : '/demo');
    const host = name.startsWith('workspace') || name.startsWith('journey') ? 'app.navitw.com' : 'navitw.com';
    return `<div class="device browser"><div class="bar"><i></i><i></i><i></i><span>${host}${path}</span></div>${shot}</div>`;
  }
  return `<div class="device phone"><div class="screen"><div class="notch"></div>${shot}</div></div>`;
}

/**
 * Labels go beside their outline, on the side with room. They are moved to the top layer of the frame,
 * so a device's rounded, clipped screen never cuts them off.
 */
const PLACE_LABELS = () => {
  for (const label of [...document.querySelectorAll('.label')]) {
    const ring = JSON.parse(label.dataset.ring);
    const shot = label.parentElement.getBoundingClientRect();
    const r = { x: shot.left + ring.x, y: shot.top + ring.y, w: ring.w, h: ring.h }; // frame coordinates
    document.body.append(label);
    const lw = label.offsetWidth, lh = label.offsetHeight, gap = 48, edge = 40;
    let side, x, y;
    if (r.x + r.w + gap + lw < innerWidth - edge) { side = 'right'; x = r.x + r.w + gap; y = r.y + r.h / 2 - lh / 2; }
    else if (r.x - gap - lw > edge) { side = 'left'; x = r.x - gap - lw; y = r.y + r.h / 2 - lh / 2; }
    else if (r.y + r.h + gap + lh < innerHeight - 230) { side = 'below'; x = r.x; y = r.y + r.h + gap; }
    else { side = 'above'; x = r.x; y = r.y - gap - lh; }
    label.classList.add(side);
    label.style.left = `${Math.max(edge, Math.min(innerWidth - lw - edge, x))}px`;
    label.style.top = `${Math.max(110, Math.min(innerHeight - lh - 230, y))}px`;
  }
};

function cardHtml(scene, byName) {
  if (scene.card === 'concept') {
    return `<div class="card"><div class="mark-logo">${LOGO}</div><div class="name">NAVI</div><div class="tag">理解・檢核・帶你去</div><div class="sub">像聊天一樣說出你的情況，NAVI 先問清楚、找到官網依據，再帶你到正確的地方</div></div>`;
  }
  if (scene.card === 'logo') {
    return `<div class="card"><div class="mark-logo">${LOGO}</div><div class="name">NAVI</div><div class="tag">智慧服務導航助手</div><div class="sub">AfterZero ｜ 靜宜大學 資訊管理學系</div></div>`;
  }
  const tiles = [
    ['mobile', 'navi-welcome', '聊天室', '說出情況、點選項'],
    ['mobile', 'journey-card', '旅程卡', '一句話建立服務旅程'],
    ['mobile', 'workspace-70', '工作區', '準備度與文件健檢'],
    ['mobile', 'guide-step-1-card', '導覽卡', '一步一步帶你去'],
    ['mobile', 'guide-step-2', '官網高亮', '框出正確位置'],
  ];
  return `<div class="card"><div class="tiles">${tiles.map(([dir, name, title, sub]) => `<div class="tile"><div class="pic"><img src="${pathToFileURL(resolve(byName[`${dir}/${name}`].file)).href}"></div><b>${title}</b><small>${sub}</small></div>`).join('')}</div></div>`;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const report = JSON.parse(await readFile(join(BROLL, 'report.json'), 'utf8'));
  const byName = Object.fromEntries(report.map(r => [`${r.dir}/${r.name}`, r]));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const files = [];
  for (const [index, scene] of SCENES.entries()) {
    let body;
    if (scene.card) body = cardHtml(scene, byName);
    else {
      const both = scene.shots.length > 1;
      const devices = scene.shots.map(spec => {
        const entry = byName[`${spec[0]}/${spec[1]}`];
        if (!entry) throw new Error(`Missing B-roll shot: ${spec[0]}/${spec[1]}`);
        const maxW = spec[0] === 'desktop' ? (both ? 1180 : 1560) : 400;
        return deviceHtml(entry, spec, maxW, 760);
      });
      body = `<div class="stage">${devices.join('')}</div>`;
    }
    const caption = scene.caption ? `<div class="caption"><div class="section">${scene.section}</div><div class="line">${scene.caption}</div></div>` : '';
    const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&family=DM+Sans:wght@500;700&display=swap"><style>${CSS}</style>
      <div class="time">${scene.time}</div>${scene.card === 'logo' ? '' : '<div class="badge">示範模式・合成資料</div>'}${body}${caption}`;
    const htmlFile = join(OUT, 'scene.html');
    await writeFile(htmlFile, html);
    await page.goto(pathToFileURL(resolve(htmlFile)).href);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every(i => i.complete));
    await page.evaluate(PLACE_LABELS);
    const file = join(OUT, `${String(index + 1).padStart(2, '0')}-${scene.card ?? scene.shots[0][1]}.png`);
    await page.screenshot({ path: file });
    files.push(file);
    console.log(file);
  }
  await browser.close();
  console.log(`${files.length} storyboard frames in ${OUT}`);
}

main().catch(error => { console.error(error); process.exit(1); });
