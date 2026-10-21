import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectPublicKnowledge } from '../../../shared/publicKnowledge.js';
import seed from '../../../data/cardif_seed_data.json' with { type: 'json' };
import published from '../../../data/cardif_public_data.json' with { type: 'json' };
import policy from '../../../scripts/security/excluded-note-fingerprints.json' with { type: 'json' };
import { fingerprint, inspectPublicText, scanPublicArtifacts } from '../../../scripts/security/public-artifacts.js';
import { generatePublicKnowledge } from '../../../scripts/knowledge/project-public.js';

const canary='NAVI PRIVATE CANARY ONLY FOR SYNTHETIC SECURITY TESTS 2026';
test('allowlist projection rejects new private fields recursively while preserving public IDs and nested sitemap', async () => {
  const injected=structuredClone(seed);injected.internal_notes=canary;injected.meta.internal_notes=canary;injected.services[0].internal_notes={value:canary};injected.forms[0].privateReview=canary;injected.faq[0].customerData=canary;injected.sitemap[0].internal_notes=canary;
  assert.deepEqual(projectPublicKnowledge(injected),published);
  assert.deepEqual(projectPublicKnowledge(seed),seed);
  assert.deepEqual(published.services.map(s=>s.id),seed.services.map(s=>s.id));
  assert.deepEqual(published.sitemap,seed.sitemap);
  await generatePublicKnowledge({check:true});
});
test('artifact scanner rejects plain, Unicode, hex, URL, HTML and base64 encoded private notes and field names', () => {
  const escaped=Array.from(canary,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
  const hex=Array.from(canary,c=>'\\x'+c.charCodeAt(0).toString(16).padStart(2,'0')).join('');
  const variants=[canary,escaped,hex,encodeURIComponent(canary),Array.from(canary,c=>'&#'+c.codePointAt(0)+';').join(''),Buffer.from(canary).toString('base64')];
  for(const text of variants)assert.ok(inspectPublicText(text,[fingerprint(canary)]).includes('excluded_note_fingerprint'));
  for(const text of ['internal_notes','internal_\\u006eotes',Buffer.from('internal_notes: synthetic forbidden note').toString('base64')])assert.ok(inspectPublicText(text).some(f=>f.startsWith('private_field:')));
  assert.deepEqual(inspectPublicText('住院醫療理賠需要準備的文件，請查看來源。',policy.fingerprints),[]);
});
test('production scanner inspects JS, JSON, source maps and static export; missing roots fail closed', async t => {
  const root=await mkdtemp(join(tmpdir(),'navi-public-artifact-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const safe=join(root,'safe');await mkdir(safe);await writeFile(join(safe,'index.js'),'console.log("public")');
  assert.equal((await scanPublicArtifacts([safe],[])).passed,true);
  const bad=join(root,'bad');await mkdir(bad);
  for(const name of ['index.js','data.json','index.js.map','index.html','page.rsc'])await writeFile(join(bad,name),JSON.stringify({payload:canary}));
  const result=await scanPublicArtifacts([bad],[fingerprint(canary)]);assert.equal(result.passed,false);assert.equal(result.findings.length,5);
  await assert.rejects(scanPublicArtifacts([join(root,'missing')],[]));
});
