import { isDeepStrictEqual } from 'node:util';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { projectPublicKnowledge } from '../../shared/publicKnowledge.js';
import { validateRelease, atomicJson } from './lifecycle.js';

export async function generatePublicKnowledge({ check = false } = {}) {
  const raw = JSON.parse(await readFile(new URL('../../data/cardif_seed_data.json', import.meta.url), 'utf8'));
  let projected = projectPublicKnowledge(raw);
  const current = JSON.parse(await readFile(new URL('../../data/cardif_public_data.json', import.meta.url), 'utf8'));
  if (current.meta.knowledgeVersion) {
    const release = JSON.parse(await readFile(new URL(`../../knowledge/releases/${current.meta.knowledgeVersion}.json`, import.meta.url), 'utf8'));
    if (release.syntheticDemo && !existsSync(new URL('../../.synthetic-knowledge-demo', import.meta.url))) throw Error('Synthetic demonstration cannot be built as public knowledge');
    projected = validateRelease(release).snapshot;
    if (!isDeepStrictEqual(current, projected)) throw Error('Published knowledge does not match its immutable release');
  }
  if (check && !isDeepStrictEqual(raw, projectPublicKnowledge(raw))) throw Error('Seed contains non-public metadata; move it to controlled local storage before building');
  const output = JSON.stringify(projected, null, 2) + '\n';
  const target = new URL('../../data/cardif_public_data.json', import.meta.url);
  if (check) {
    if (!current.meta.knowledgeVersion && await readFile(target, 'utf8') !== output) throw Error('Public knowledge projection is stale; run npm run knowledge:project');
  } else if (!current.meta.knowledgeVersion) atomicJson(fileURLToPath(target), projected, 0o644);
  return { status: 'ok', mode: check ? 'check' : 'generate', bytes: Buffer.byteLength(output) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw Error('Use --check or no arguments');
  console.log(JSON.stringify(await generatePublicKnowledge({ check: process.argv.includes('--check') })));
}
