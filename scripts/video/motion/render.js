// Renders navi-motion.html deterministically with Playwright (every frame = seek(t)).
//   node scripts/video/motion/render.js preview [loop|intro]   # one frame per beat + contact sheet
//   node scripts/video/motion/render.js full [loop|intro]      # 60 fps, 4 temporal sub-frames, + audio
// Output: artifacts/video/motion/<version>/ (git-ignored).
import { chromium } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const [mode = 'preview', version = 'loop'] = process.argv.slice(2);
const HERE = resolve('scripts/video/motion');
const OUT = resolve('artifacts/video/motion', version);
const FPS = 60, SUB = 4;

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`${pathToFileURL(join(HERE, 'navi-motion.html'))}?version=${version}`);
  await page.evaluate(() => window.ready);
  const { duration, score } = await page.evaluate(() => ({ duration: window.DURATION, score: window.SCORE }));
  await writeFile(join(OUT, 'score.json'), JSON.stringify({ version, duration, bpm: 120, events: score }, null, 2));
  const shot = async (t, path, type = 'png') => {
    await page.evaluate(x => window.seek(x), t);
    await page.screenshot({ path, type, ...(type === 'jpeg' ? { quality: 94 } : {}) });
  };

  if (mode === 'preview') {
    // One representative frame per beat (0.3 s after the beat, when the action has landed).
    const dir = join(OUT, 'beats');
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const beats = Math.round(duration / 0.5);
    for (let b = 0; b < beats; b++) await shot(b * 0.5 + 0.3, join(dir, `beat-${String(b + 1).padStart(2, '0')}.png`));
    // Loop check: the last frame must equal the first.
    await shot(0, join(OUT, 'loop-start.png'));
    await shot(duration - 1e-6, join(OUT, 'loop-end.png'));
    await browser.close();
    const cols = 4; // one row per bar
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-pattern_type', 'glob', '-i', join(dir, 'beat-*.png'),
      // Beat order, left to right; one row per bar (4 beats).
      '-vf', `scale=480:270,tile=${cols}x${Math.ceil(beats / cols)}:padding=6:margin=6:color=0xD9D6CF`,
      '-frames:v', '1', join(OUT, 'contact-sheet.png')]);
    console.log(`Preview: ${join(OUT, 'contact-sheet.png')}`);
    return;
  }

  // Full render: SUB sub-frames per output frame, blended by ffmpeg tmix (subtle motion blur).
  const dir = join(OUT, 'sub');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const frames = Math.round(duration * FPS), dt = 1 / (FPS * SUB);
  let n = 0;
  for (let f = 0; f < frames; f++) {
    for (let s = 0; s < SUB; s++) {
      const t = f / FPS + (s - (SUB - 1) / 2) * dt; // t-1.5Δ … t+1.5Δ (the loop version wraps inside seek)
      await shot(t, join(dir, `${String(n++).padStart(6, '0')}.jpg`), 'jpeg');
    }
    if (f % 120 === 0) console.log(`frame ${f}/${frames}`);
  }
  await browser.close();
  await run('python3', [join(HERE, 'audio.py'), join(OUT, 'score.json'), join(OUT, 'audio.wav')]);
  const mp4 = join(OUT, `navi-motion-${version}.mp4`);
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS * SUB), '-i', join(dir, '%06d.jpg'), '-i', join(OUT, 'audio.wav'),
    '-vf', `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/(${FPS}*TB)`, '-r', String(FPS),
    '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4], { maxBuffer: 1 << 26 });
  await rm(dir, { recursive: true, force: true });
  console.log(`Rendered ${mp4}`);
}

main().catch(error => { console.error(error); process.exit(1); });
