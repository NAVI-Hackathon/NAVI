import { isDeepStrictEqual } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { projectPublicKnowledge } from '../../shared/publicKnowledge.js';

export async function generatePublicKnowledge({ check = false } = {}) {
  const raw = JSON.parse(await readFile(new URL('../../data/cardif_seed_data.json', import.meta.url), 'utf8'));
  const projected = projectPublicKnowledge(raw);
  if (check && !isDeepStrictEqual(raw, projected)) throw Error('Seed contains non-public metadata; move it to controlled local storage before building');
  const output = JSON.stringify(projected, null, 2) + '\n';
  const target = new URL('../../data/cardif_public_data.json', import.meta.url);
  if (check) {
    if (await readFile(target, 'utf8') !== output) throw Error('Public knowledge projection is stale; run npm run knowledge:project');
  } else await writeFile(target, output);
  return { status: 'ok', mode: check ? 'check' : 'generate', bytes: Buffer.byteLength(output) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw Error('Use --check or no arguments');
  console.log(JSON.stringify(await generatePublicKnowledge({ check: process.argv.includes('--check') })));
}
