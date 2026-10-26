// Renders film.html (110 BPM) deterministically (every frame = seek(t)) with the B-roll stills from capture-broll.js.
//   node scripts/video/film/render.js preview [text|vo]   # one frame per bar + contact sheet, timeline.json, .srt
//   node scripts/video/film/render.js full [text|vo]      # 30 fps + synthesised score → mp4
// text: on-screen captions only. vo: captions + narration subtitles, music ducked under the narration.
// Output: artifacts/video/film/<version>/ (git-ignored).
import { chromium } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const [mode = 'preview', version = 'text'] = process.argv.slice(2);
const HERE = resolve('scripts/video/film');
const BROLL = resolve('artifacts/video/film/broll');
const OUT = resolve('artifacts/video/film', version);
const FPS = Number(process.env.FPS ?? 30);

/** Shots keyed "desktop/name", with the browser bar's address for desktop frames. */
async function filmData() {
  const report = JSON.parse(await readFile(join(BROLL, 'report.json'), 'utf8'));
  const shots = {};
  for (const r of report) {
    const app = r.name.startsWith('workspace') || r.name.startsWith('journey') || r.name.startsWith('review') || r.name === 'handoff';
    const path = app ? '/demo' : r.name.startsWith('guide') || r.name === 'navi-guardrail' || r.name === 'navi-address-answer' ? '/services/policy-change' : r.name.startsWith('claims') || r.name.startsWith('navi') ? '/services/claims' : `/${r.name}`;
    shots[`${r.dir}/${r.name}`] = { url: pathToFileURL(resolve(r.file)).href, viewport: r.viewport, marks: r.marks, host: app ? 'app.navitw.com' : 'navitw.com', path };
  }
  return { shots };
}

const srtTime = s => { const ms = Math.round(s * 1000); const p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => { console.error(error); process.exitCode = 1; });
  await page.addInitScript(data => { window.FILM_DATA = data; }, await filmData());
  await page.goto(`${pathToFileURL(join(HERE, 'film.html'))}?version=${version}`);
  await page.evaluate(() => window.ready);
  const { duration, score, music, vo, scenes } = await page.evaluate(() => ({ duration: window.DURATION, score: window.SCORE, music: window.MUSIC, vo: window.VO, scenes: window.SCENE_STARTS }));
  await writeFile(join(OUT, 'score.json'), JSON.stringify({ version, duration, music, events: score, vo: version === 'vo' ? vo : [] }, null, 2));
  await writeFile(join(OUT, 'timeline.json'), JSON.stringify({ duration, scenes, vo }, null, 2));
  await writeFile(join(OUT, 'narration.srt'), vo.map((v, i) => `${i + 1}\n${srtTime(v.start)} --> ${srtTime(v.end)}\n${v.text}\n`).join('\n'));
  const shot = async (t, path, type = 'png') => {
    await page.evaluate(x => window.seek(x), t);
    await page.screenshot({ path, type, ...(type === 'jpeg' ? { quality: 92 } : {}) });
  };
  const BAR = 240 / music.bpm;

  if (mode === 'preview') {
    // One frame per bar, three quarters in (after the outline and its label have landed).
    const dir = join(OUT, 'bars');
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const bars = Math.round(duration / BAR);
    for (let b = 0; b < bars; b++) await shot(b * BAR + BAR * 0.75, join(dir, `bar-${String(b + 1).padStart(2, '0')}.png`));
    await browser.close();
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-pattern_type', 'glob', '-i', join(dir, 'bar-*.png'),
      '-vf', `scale=384:216,tile=5x${Math.ceil(bars / 5)}:padding=6:margin=6:color=0x202020`, '-frames:v', '1', join(OUT, 'contact-sheet.png')]);
    console.log(`Preview: ${join(OUT, 'contact-sheet.png')} (${bars} bars, ${duration.toFixed(1)} s)`);
    return;
  }

  const dir = join(OUT, 'frames');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const frames = Math.round(duration * FPS);
  for (let f = 0; f < frames; f++) {
    await shot(f / FPS, join(dir, `${String(f).padStart(6, '0')}.jpg`), 'jpeg');
    if (f % (FPS * 10) === 0) console.log(`frame ${f}/${frames}`);
  }
  await browser.close();
  await run('python3', [join(HERE, 'film-audio.py'), join(OUT, 'score.json'), join(OUT, 'audio.wav')]);
  const mp4 = join(OUT, `navi-demo-${version}.mp4`);
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', join(dir, '%06d.jpg'), '-i', join(OUT, 'audio.wav'),
    '-c:v', 'libx264', '-crf', '17', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4], { maxBuffer: 1 << 26 });
  await rm(dir, { recursive: true, force: true });
  console.log(`Rendered ${mp4}`);
}

main().catch(error => { console.error(error); process.exit(1); });
