#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, mkdirSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initializeStore, bootstrap, importCandidates, listReviews, decide, approveFaqAppend, publish, rollback, status, compareVersions, atomicJson, sha256 } from './lifecycle.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries([
  ...['root','store','token-file','report','snapshot','change','status','reviewer','reason','mapping','version','left','right','out','baseline','from-snapshot','source'].map(name => [name,{type:'string'}]),
  ['whole-page-confirmed',{type:'boolean'}],
]) });
const root = resolve(values.root ?? fileURLToPath(new URL('../../', import.meta.url)));
const store = resolve(values.store ?? join(root,'data/private/knowledge'));
const tokenFile = values['token-file'];
const json = path => JSON.parse(readFileSync(path,'utf8'));
function previousPages(report) {
  if(!report.baseline || !existsSync(resolve(root,report.baseline))) return [];
  const text=readFileSync(resolve(root,report.baseline),'utf8').trim();
  return text.startsWith('[')?JSON.parse(text):text.split('\n').map(JSON.parse);
}
function snapshotPages(directory) {
  const pages=readFileSync(join(directory,'pages.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  for(const page of pages) if(page.rawSnapshot) {
    if(!/^[a-z0-9-]+\.html$/.test(page.rawSnapshot)) throw Error('Unsafe raw snapshot path');
    const file=join(directory,'raw',page.rawSnapshot);
    if(lstatSync(file).isSymbolicLink() || sha256(readFileSync(file))!==page.rawContentSha256) throw Error('Raw HTML snapshot hash mismatch');
  }
  return pages;
}
let result;
switch (positionals[0]) {
  case 'init': {
    const initialized = initializeStore(store);
    result = { ...initialized, release: await bootstrap({root,store,tokenFile:initialized.tokenFile}) }; break;
  }
  case 'status': result = status(root); break;
  case 'import': {
    if (!values.report || !values.snapshot) throw Error('需要 --report 與 --snapshot。');
    result = await importCandidates({store,tokenFile,report:json(values.report),pages:snapshotPages(values.snapshot),previousPages:previousPages(json(values.report))}); break;
  }
  case 'refresh': {
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    const out = resolve(values.out ?? join(store,'captures',stamp));
    mkdirSync(dirname(out),{recursive:true,mode:0o700});
    const args = [join(root,'scripts/crawler/targeted_review.py'),'--out',out,'--report',out+'.diff.md','--baseline',resolve(values.baseline ?? (existsSync(join(store,'latest-pages.json')) ? join(store,'latest-pages.json') : join(root,'data/crawl/candidate-2026-10-21/pages.jsonl')))];
    if (values.source) args.push('--only-source',values.source);
    if (values['from-snapshot']) args.push('--from-snapshot',resolve(values['from-snapshot']));
    // Validate local authority before any network activity or file mutation.
    const { locked } = await import('./lifecycle.js');
    await locked(store,tokenFile,()=>{ const run=spawnSync(process.env.NAVI_CRAWLER_PYTHON || 'python3',args,{cwd:root,stdio:'inherit'}); if(run.status!==0) throw Error('擷取未完成，既有正式快照不變。'); });
    const imported=await importCandidates({store,tokenFile,report:json(out+'.diff.json'),pages:snapshotPages(out),previousPages:previousPages(json(out+'.diff.json'))});
    await locked(store,tokenFile,()=>{
      const baseline=readFileSync(args[args.indexOf('--baseline')+1],'utf8').trim();
      const previous=existsSync(join(store,'latest-pages.json'))?json(join(store,'latest-pages.json')):baseline.startsWith('[')?JSON.parse(baseline):baseline.split('\n').map(JSON.parse);
      const latest=new Map(previous.map(page=>[page.sourceUrl ?? page.url,page]));
      for(const page of snapshotPages(out)) if(page.extractionStatus==='ok' && (!latest.get(page.sourceUrl)?.retrievedAt || page.retrievedAt>=latest.get(page.sourceUrl).retrievedAt)) latest.set(page.sourceUrl,{...page,captureDirectory:out});
      atomicJson(join(store,'latest-pages.json'),[...latest.values()]);
    });
    result={out,diff:out+'.diff.json',...imported}; break;
  }
  case 'review': {
    if (!values.change) {
      result=listReviews(store);
      if(values.out) { if(existsSync(values.out)) throw Error('審核報告請使用全新路徑，不可覆寫既有檔案。'); mkdirSync(dirname(resolve(values.out)),{recursive:true}); writeFileSync(values.out,['# Knowledge 候選審核清單','',...result.flatMap(c=>[
        `## ${c.changeId} — ${c.status}`,`來源：${c.sourceId} ${c.sourceUrl}`,`擷取：${c.retrievedAt}`,`Stable paragraph：${c.stableParagraphId}`,`前 SHA-256：${c.old?.sha256 ?? '無'}`,`後 SHA-256：${c.new?.sha256 ?? '無'}`,
        '### 修改前','```text',c.old?.text ?? c.previousContext ?? '無（舊快照未收錄）','```','### 修改後','```text',c.new?.text ?? c.context,'```',`影響：${c.knowledgeIds.join(', ') || '尚無對應，需A確認導航'}`,`審核時間：${c.decision?.at ?? '尚未審核'}`,`審核：${c.decision?.reviewer ?? '待人工'}；${c.decision?.reason ?? ''}`,'',
      ])].join('\n')); result={report:resolve(values.out),items:result.length}; }
    } else result=await decide({root,store,tokenFile,changeId:values.change,status:values.status,reviewer:values.reviewer,reason:values.reason,mapping:values.mapping?json(values.mapping):undefined,wholePageConfirmed:values['whole-page-confirmed']});
    break;
  }
  case 'publish': result=await publish({root,store,tokenFile,changeIds:values.change?.split(',')}); break;
  case 'approve-faqs': result=await approveFaqAppend({root,store,tokenFile,plan:json(values.mapping),reviewer:values.reviewer,reason:values.reason,wholePageConfirmed:values['whole-page-confirmed']}); break;
  case 'rollback': result=await rollback({root,store,tokenFile,version:values.version,reviewer:values.reviewer,reason:values.reason}); break;
  case 'diff': result=compareVersions(root,values.left,values.right); break;
  default: throw Error('使用 init / refresh / import / review / publish / status / diff / rollback；寫入需要 --token-file。');
}
console.log(JSON.stringify(result,null,2));
