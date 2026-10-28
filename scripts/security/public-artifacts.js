import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const privateFieldNames = ['internal_notes', 'previous_online_note', 'known_inconsistencies', 'data_gaps', 'partner_hospitals_note', 'transfer_companies_note'];
export const normalizeForScan = text => text.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
const digest = text => createHash('sha256').update(text).digest('hex');
export function fingerprint(text) {
  const normalized = normalizeForScan(text);
  return { length: Array.from(normalized).length, sha256: digest(normalized) };
}
export function decodedViews(text) {
  const decode = value => {
  let decoded = value;
  for (let round = 0; round < 3; round++) {
    decoded = decoded.replace(/\\\\/g, '\\').replace(/\\u\{([a-f0-9]{1,6})\}|\\u([a-f0-9]{4})|\\x([a-f0-9]{2})/gi, (match,a,b,c) => {
      const value = parseInt(a ?? b ?? c,16); return value <= 0x10ffff ? String.fromCodePoint(value) : match;
    }).replace(/&#(?:x([a-f0-9]+)|(\d+));/gi,(match,hex,dec)=>{
      const value = parseInt(hex ?? dec,hex ? 16 : 10); return value <= 0x10ffff ? String.fromCodePoint(value) : match;
    }).replace(/&quot;|&apos;|&amp;|&lt;|&gt;/g,match=>({'&quot;':'"','&apos;':"'",'&amp;':'&','&lt;':'<','&gt;':'>'})[match])
      .replace(/(?:%[a-f0-9]{2})+/gi,match=>{try{return decodeURIComponent(match);}catch{return match;}})
      .replace(/\\(["'\/\\])/g,'$1');
  }
  return decoded;
  };
  const decoded = decode(text);
  const views = [decoded];
  for (const token of decoded.match(/[A-Za-z0-9+/]{24,}={0,2}/g) ?? []) {
    if(token.length > 4 * 1024 * 1024) continue;
    const bytes = Buffer.from(token,'base64');
    const value = bytes.toString('utf8');
    if(!value.includes('\ufffd') && bytes.toString('base64').replace(/=+$/,'') === token.replace(/=+$/,'')) views.push(decode(value));
  }
  return views.map(normalizeForScan);
}
export function inspectPublicText(text, fingerprints = []) {
  const findings = new Set();
  const byLength = new Map();
  for(const item of fingerprints) { if(!byLength.has(item.length)) byLength.set(item.length,new Set()); byLength.get(item.length).add(item.sha256); }
  for(const view of decodedViews(text)) {
    if(/mongodb(?:\+srv)?:\/\/[^:/\s]+:[^@/\s]+@|aiza[a-z0-9_-]{35}|-----begin(?:rsa|ec|openssh)?privatekey-----/.test(view))findings.add('server_credential');
    for(const name of ['mongodb_uri','smtp_password','navi_data_encryption_key','navi_admin_token'])if(view.includes(name))findings.add('server_configuration:'+name);
    for(const name of privateFieldNames) if(view.includes(name)) findings.add(`private_field:${name}`);
    if(byLength.size) {
      const chars = Array.from(view);
      for(const [length, hashes] of byLength) for(let index=0;index+length<=chars.length;index++) {
        if(hashes.has(digest(chars.slice(index,index+length).join('')))) { findings.add('excluded_note_fingerprint'); break; }
      }
    }
  }
  return [...findings];
}
export async function scanPublicArtifacts(roots, fingerprints) {
  if(!roots.length) throw Error('At least one public build directory is required');
  const files = [], findings = [];
  async function visit(path) {
    const info=await lstat(path);
    if(info.isSymbolicLink()) throw Error('Public artifact scanner refuses symlinks');
    if(info.isDirectory()) for(const entry of await readdir(path)) await visit(resolve(path,entry));
    else if(/\.(?:[cm]?js|json|map|html|rsc|txt|css|xml|svg|meta|webmanifest)$/i.test(extname(path))) files.push(path);
  }
  for(const root of roots) await visit(resolve(root));
  if(!files.length) throw Error('No inspectable public artifacts found');
  let bytes=0; const byExtension={};
  for(const path of files) {
    const buffer=await readFile(path);bytes+=buffer.length;byExtension[extname(path)]=(byExtension[extname(path)]??0)+1;
    const rejected=inspectPublicText(buffer.toString('utf8'),fingerprints);
    if(rejected.length)findings.push({file:relative(process.cwd(),path),reasons:rejected});
  }
  return {passed:findings.length===0,files:files.length,bytes,byExtension,findings};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const policy=JSON.parse(await readFile(new URL('./excluded-note-fingerprints.json',import.meta.url),'utf8'));
  const result=await scanPublicArtifacts(process.argv.slice(2),policy.fingerprints);
  console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
}
