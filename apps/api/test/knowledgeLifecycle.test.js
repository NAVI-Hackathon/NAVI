import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, chmodSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import seed from '../../../data/cardif_seed_data.json' with { type: 'json' };
import { initializeStore, bootstrap, importCandidates, listReviews, decide, approveFaqAppend, publish, rollback, status, compareVersions, sha256, validateRelease, atomicJson, locked } from '../../../scripts/knowledge/lifecycle.js';
import { createKnowledgeEngine } from '../../../shared/knowledge/index.js';
import { runDemonstration } from '../../../scripts/knowledge/demo.js';
import { offlineNetworkStats } from './networkGuard.js';
import { evaluateKnowledge, loadKnowledgeDataset } from '../eval/knowledge/runner.js';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
const quickEvaluation=async engine=>({failed:0, sources:engine.knowledgeEntries.length});
async function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'navi-lifecycle-test-')); t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'data'));writeFileSync(join(root,'data/cardif_seed_data.json'),JSON.stringify(seed));writeFileSync(join(root,'data/cardif_public_data.json'),JSON.stringify(seed));
  writeFileSync(join(root,'.synthetic-knowledge-demo'),'test only');
  const store=join(root,'private'), {tokenFile}=initializeStore(store);
  const input={root,store,tokenFile,evaluate:quickEvaluation};await bootstrap(input);
  const before=status(root); const content=seed.faq[0].a+'\n合成測試：Knowledge lifecycle fixture，不是官方規則。';
  const candidate={changeId:'test:faq',category:'Modified',sourceId:'snapshot:fixture',sourceUrl:seed.faq[0].source,retrievedAt:'2026-10-21T12:00:00+08:00',old:{id:'stable-p',text:seed.faq[0].a,sha256:sha256(seed.faq[0].a)},new:{id:'stable-p',text:content,sha256:sha256(content)},knowledgeIds:['faq:1'],navigationTargets:[]};
  const page={sourceUrl:candidate.sourceUrl,extractionStatus:'ok',content_md:content,normalizedContentSha256:sha256(content),rawContentSha256:sha256('<p>'+content+'</p>')};
  const report={changes:[candidate]}, pages=[page];
  await importCandidates({...input,report,pages});
  const mapping={sourceId:'faq:1',field:'a',value:content,entryReviewed:true,workflowCompatibility:'reviewed_no_rule_change'};
  const approve=(overrides={})=>decide({...input,changeId:candidate.changeId,status:'APPROVED',reviewer:'SYNTHETIC-TEST-REVIEWER',reason:'isolated test only',mapping,synthetic:true,...overrides});
  return {...input,before,candidate,page,report,pages,mapping,approve,content};
}
test('Repeated import is idempotent and new candidates remain PENDING',async t=>{
  const f=await fixture(t); const again=await importCandidates({...f,report:f.report,pages:f.pages});
  assert.equal(again.added,0);assert.equal(listReviews(f.store).length,1);assert.equal(listReviews(f.store)[0].status,'PENDING');assert.equal(status(f.root).knowledgeVersion,f.before.knowledgeVersion);
});
test('PENDING and REJECTED candidates cannot publish',async t=>{
  const f=await fixture(t);
  for(const state of ['PENDING','REJECTED','NEEDS_FOLLOWUP']) {
    await f.approve({status:state});await assert.rejects(publish({...f,changeIds:['test:faq'],synthetic:true}),/只能發布/);
    assert.equal(status(f.root).knowledgeVersion,f.before.knowledgeVersion);
  }
});
test('Approval requires authorization, reviewer identity and reason',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.approve({tokenFile:undefined}),/未授權/);
  const wrong=join(f.store,'wrong');writeFileSync(wrong,'wrong-key',{mode:0o600});await assert.rejects(f.approve({tokenFile:wrong}),/未授權/);
  await assert.rejects(f.approve({reviewer:''}),/審核者/);await assert.rejects(f.approve({reason:''}),/理由/);
  assert.equal(listReviews(f.store)[0].status,'PENDING');
});
test('Approved release is searchable, versioned, grounded and navigable; publish is idempotent',async t=>{
  const f=await fixture(t);await f.approve();const released=await publish({...f,synthetic:true});
  assert.equal(released.adopted,1);assert.equal(released.previousRelease,f.before.knowledgeVersion);
  const snapshot=JSON.parse(readFileSync(join(f.root,'data/cardif_public_data.json'))),engine=createKnowledgeEngine(snapshot);
  const entry=engine.searchKnowledge('faq:1').results[0];assert.equal(entry.knowledgeVersion,released.knowledgeVersion);assert.equal(entry.sourceType,'synthetic_demo');
  assert.equal(entry.sourceUrl,f.candidate.sourceUrl);assert.equal(entry.retrievedAt,'2026-10-21');
  assert.ok(engine.verifyNavigationDestination(entry.destination,entry.id));assert.ok(f.content.split('\n').every(line=>engine.verifyEvidenceSnippet(entry.id,line)));
  assert.equal((await publish({...f,synthetic:true})).adopted,0);
});
test('Rollback restores previous search, source dates and version; audit survives',async t=>{
  const f=await fixture(t);await f.approve();const next=await publish({...f,synthetic:true});
  const diff=compareVersions(f.root,f.before.knowledgeVersion,next.knowledgeVersion);assert.equal(diff.changes[0].sourceId,'faq:1');
  const restored=await rollback({...f,reviewer:'SYNTHETIC-TEST',reason:'rollback test'});assert.equal(restored.knowledgeVersion,f.before.knowledgeVersion);
  const engine=createKnowledgeEngine(JSON.parse(readFileSync(join(f.root,'data/cardif_public_data.json'))));assert.equal(engine.getKnowledgeEntry('faq:1').content,seed.faq[0].a);
  assert.equal(listReviews(f.store)[0].status,'APPROVED');assert.ok(JSON.parse(readFileSync(join(f.store,'audit.json'))).some(x=>x.action==='ROLLBACK'));
});
test('Unauthorized publish and rollback cannot change public snapshot',async t=>{
  const f=await fixture(t);await f.approve();
  await assert.rejects(publish({...f,tokenFile:undefined,synthetic:true}));await assert.rejects(rollback({...f,tokenFile:undefined,reviewer:'x',reason:'x'}));assert.equal(status(f.root).knowledgeVersion,f.before.knowledgeVersion);
});
test('Tampered review or candidate cannot enter a release',async t=>{
  const f=await fixture(t);await f.approve();const path=join(f.store,'candidates.json'),items=JSON.parse(readFileSync(path));items[0].new.text+='UNAPPROVED';atomicJson(path,items);
  await assert.rejects(publish({...f,synthetic:true}),/完整性/);assert.equal(status(f.root).knowledgeVersion,f.before.knowledgeVersion);
  const auditPath=join(f.store,'audit.json'),audit=JSON.parse(readFileSync(auditPath));audit.at(-1).reviewer='FORGED';atomicJson(auditPath,audit);assert.throws(()=>listReviews(f.store),/驗證失敗/);
});
test('Schema, security, snapshot hashes and source manifests fail closed',async t=>{
  const f=await fixture(t),path=join(f.root,'knowledge/releases',f.before.knowledgeVersion+'.json'),valid=JSON.parse(readFileSync(path));
  for(const mutate of [r=>{r.snapshot.faq[0].retrievedAt='2026-02-30';},r=>{r.snapshot.faq[0].internal_notes='SECRET';},r=>{r.snapshotHash='0'.repeat(64);},r=>{r.sourceManifest[0].sourceUrl='https://evil.invalid';}]) {
    const bad=structuredClone(valid);mutate(bad);assert.throws(()=>validateRelease(bad));
  }
});
test('Unknown source IDs, navigation and business-rule edits require a separate migration',async t=>{
  const f=await fixture(t);
  for(const mapping of [{...f.mapping,sourceId:'faq:9999'},{...f.mapping,field:'url'},{...f.mapping,workflowCompatibility:'changed_rules'},{...f.mapping,value:'沒有來源支持的承諾'}]) await assert.rejects(f.approve({mapping}));
  assert.equal(listReviews(f.store)[0].status,'PENDING');
});
test('Failed evaluation preserves current release and snapshot atomically',async t=>{
  const f=await fixture(t);await f.approve();const before=readFileSync(join(f.root,'data/cardif_public_data.json'),'utf8');
  await assert.rejects(publish({...f,synthetic:true,evaluate:async()=>({failed:1})}),/Evaluation/);
  assert.equal(readFileSync(join(f.root,'data/cardif_public_data.json'),'utf8'),before);
});
test('Overlapping writes cannot race past the lifecycle lock',async t=>{
  const f=await fixture(t);let release;const gate=new Promise(resolve=>{release=resolve;});const held=locked(f.store,f.tokenFile,()=>gate);
  await assert.rejects(f.approve(),/已有 Knowledge/);release();await held;await f.approve();
});
test('Whole-page review needs an explicit confirmation and does not adopt content itself',async t=>{
  const f=await fixture(t);const whole={...f.candidate,changeId:'test:whole',category:'Requires Manual Review',old:null,new:null};
  await importCandidates({...f,report:{changes:[whole]},pages:f.pages});
  await assert.rejects(f.approve({changeId:'test:whole'}),/整頁/);
  await f.approve({changeId:'test:whole',wholePageConfirmed:true});
  const result=await publish({...f,changeIds:['test:whole'],synthetic:true});assert.equal(result.adopted,0);assert.equal(result.knowledgeVersion,f.before.knowledgeVersion);
});
test('Fetch/extraction failures are not imported as deletions or changes',async t=>{
  const f=await fixture(t);
  const result=await importCandidates({...f,report:{changes:[{...f.candidate,changeId:'failure',category:'Fetch Failed'}]},pages:[]});assert.equal(result.added,0);assert.equal(result.total,1);
});
test('Raw and normalized candidate hashes and retrieval timestamps are validated',async t=>{
  const f=await fixture(t);
  for(const overrides of [{retrievedAt:'2026-10-21'},{sourceUrl:'https://evil.invalid/x'},{new:{...f.candidate.new,sha256:'0'.repeat(64)}}]) await assert.rejects(importCandidates({...f,report:{changes:[{...f.candidate,...overrides}]},pages:f.pages}));
});
test('Sensitive source deletion remains gated; approved note removals can be applied',async t=>{
  const f=await fixture(t),service=seed.services.find(s=>s.notes.length>0),removed=service.notes[0];
  const remaining=service.notes.slice(1),context=remaining.join('\n')||'仍有其他公開服務說明。';
  const c={...f.candidate,changeId:'test:remove-note',category:'Removed',sourceUrl:service.url,old:{id:'stable-note',text:removed,sha256:sha256(removed)},new:null};
  const page={...f.page,sourceUrl:service.url,content_md:context,normalizedContentSha256:sha256(context)};
  await importCandidates({...f,report:{changes:[c]},pages:[page]});assert.equal(listReviews(f.store).find(x=>x.changeId===c.changeId).status,'PENDING');
  await f.approve({changeId:c.changeId,mapping:{...f.mapping,sourceId:`service:${service.id}`,field:'notes',value:remaining}});
  const result=await publish({...f,changeIds:[c.changeId],synthetic:true});assert.equal(result.adopted,1);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root,'data/cardif_public_data.json'))).services.find(s=>s.id===service.id).notes,remaining);
});
test('Synthetic demo cannot publish into a production root',async t=>{
  const f=await fixture(t);await f.approve();rmSync(join(f.root,'.synthetic-knowledge-demo'));
  await assert.rejects(publish({...f,synthetic:true}),/隔離/);assert.equal(status(f.root).knowledgeVersion,f.before.knowledgeVersion);
});
test('Reproducible full demonstration runs real ranking/evaluation and rollback without touching production',async t=>{
  const root=mkdtempSync(join(tmpdir(),'navi-full-lifecycle-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const result=await runDemonstration({directory:root});assert.equal(result.pending,'PENDING');assert.equal(result.search.verified,true);assert.equal(result.rollback,result.before);assert.equal(result.auditPreserved,true);assert.equal(result.liveGeminiRequests,0);
});
test('Published and rolled-back snapshots are consumed by actual Express Search/Evidence/Version routes',async t=>{
  const f=await fixture(t), text=seed.faq[0].a+'\n'+seed.faq[0].a;
  const c={...f.candidate,changeId:'test:server',new:{id:'server-p',text,sha256:sha256(text)}};
  const page={...f.page,content_md:text,normalizedContentSha256:sha256(text)};
  await importCandidates({...f,report:{changes:[c]},pages:[page]});
  await f.approve({changeId:c.changeId,synthetic:false,mapping:{...f.mapping,value:text}});
  const released=await publish({...f,changeIds:[c.changeId],synthetic:false});
  for(const path of ['shared','apps/api/src'])cpSync(join(repo,path),join(f.root,path),{recursive:true});
  cpSync(join(repo,'knowledge'),join(f.root,'knowledge'),{recursive:true,filter:path=>!path.includes('/knowledge/releases')});
  symlinkSync(join(repo,'node_modules'),join(f.root,'node_modules'),'dir');writeFileSync(join(f.root,'package.json'),'{"type":"module"}');
  async function inspect(expected) {
    const code=`import {createApp} from './apps/api/src/app.js';import {loadConfig} from './apps/api/src/config/env.js';const server=createApp(loadConfig({AI_MODE:'demo'})).listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));`;
    const child=spawn(process.execPath,['--import',join(repo,'apps/api/test/networkGuard.js'),'--input-type=module','-e',code],{cwd:f.root,stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',d=>{errors+=d.toString();});
    try {
      const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('API test startup timeout: '+errors)),5000);child.once('exit',()=>{clearTimeout(timer);reject(Error(errors));});child.stdout.on('data',data=>{try{const obj=JSON.parse(data.toString());if(obj.port){clearTimeout(timer);resolve(obj.port);}}catch{}});});
      const base=`http://127.0.0.1:${port}/api`;
      const version=await(await fetch(base+'/knowledge/version')).json();assert.equal(version.knowledgeVersion,expected);
      const search=await(await fetch(base+'/knowledge/search?query=faq:1')).json();assert.equal(search.knowledgeVersion,expected);assert.equal(search.results[0].id,'faq:1');
      const evidence=await(await fetch(base+'/knowledge/versioned-evidence?query=faq:1')).json();assert.equal(evidence.knowledgeVersion,expected);assert.ok(evidence.evidence.results[0].excerpts.every(line=>search.results[0].content.split('\n').includes(line)));
      const legacy=await(await fetch(base+'/knowledge/evidence?query=faq:1')).json();assert.equal(legacy.status,'answered');assert.equal(Object.hasOwn(legacy,'knowledgeVersion'),false);
    } finally {child.kill('SIGTERM');await new Promise(resolve=>child.once('close',resolve));}
  }
  await inspect(released.knowledgeVersion);await rollback({...f,reviewer:'LOCAL-TEST',reason:'restore API snapshot'});await inspect(f.before.knowledgeVersion);
});
test('Demonstration refuses to overwrite existing project or user files',async t=>{
  const root=mkdtempSync(join(tmpdir(),'navi-demo-preserve-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'preserve.txt'),'user data');await assert.rejects(runDemonstration({directory:root}),/empty isolated/);
  assert.equal(readFileSync(join(root,'preserve.txt'),'utf8'),'user data');
});
test('Failed atomic serialization preserves the old file and removes temporary files',t=>{
  const root=mkdtempSync(join(tmpdir(),'navi-atomic-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const target=join(root,'snapshot.json');atomicJson(target,{version:'previous'});
  assert.throws(()=>atomicJson(target,{invalid:1n}));
  assert.deepEqual(JSON.parse(readFileSync(target)),{version:'previous'});assert.deepEqual(readdirSync(root),['snapshot.json']);
});
async function appendFixture(t) {
  const f=await fixture(t),entries=[{q:'參加這項服務的公司有哪些？',a:'固定測試公司名單。'},{q:'如何查詢這項服務的進度？',a:'固定測試查詢說明。'}];
  const context='## 固定測試Q&A\n\n'+entries.map(e=>'* '+e.q+'\n'+e.a).join('\n\n');
  const parts=entries.map((entry,i)=>{const text='* '+entry.q+'\n'+entry.a;return {...f.candidate,changeId:`append:${i}`,category:'Added',old:null,new:{id:`paragraph-${i}`,text,sha256:sha256(text)}};});
  const whole={...f.candidate,changeId:'append:whole',category:'Requires Manual Review',old:null,new:null};
  const page={...f.page,content_md:context,normalizedContentSha256:sha256(context)};
  await importCandidates({...f,report:{changes:[...parts,whole]},pages:[page]});
  const plan={operation:'append_faq',changeIds:[...parts,whole].map(c=>c.changeId),entries,anchorsConfirmed:['faq-13','faq-14'],workflowCompatibility:'reviewed_no_rule_change'};
  const approve=(overrides={})=>approveFaqAppend({...f,plan,reviewer:'FIXTURE-REVIEWER',reason:'test the explicitly approved append migration',wholePageConfirmed:true,...overrides});
  return {...f,plan,approveAppend:approve};
}
test('FAQ append requires authority, complete source review, exact quotes and confirmed anchors',async t=>{
  const f=await appendFixture(t);
  await assert.rejects(f.approveAppend({tokenFile:undefined}),/未授權/);
  await assert.rejects(f.approveAppend({wholePageConfirmed:false}),/整頁/);
  for(const plan of [{...f.plan,changeIds:f.plan.changeIds.slice(1)},{...f.plan,anchorsConfirmed:['faq-999','faq-1000']},{...f.plan,entries:[{q:'憑空的問題',a:'無來源答案'}]}]) await assert.rejects(f.approveAppend({plan}));
  assert.ok(listReviews(f.store).every(c=>c.status==='PENDING'));
});
test('Approved appended FAQs retain old IDs, dates and requirements and support rollback',async t=>{
  const f=await appendFixture(t),before=JSON.parse(readFileSync(join(f.root,'data/cardif_public_data.json'))),oldEngine=createKnowledgeEngine(before);
  const approved=await f.approveAppend();assert.equal(approved.approved,3);assert.deepEqual(approved.addedSourceIds,['faq:13','faq:14']);
  const result=await publish({...f,changeIds:f.plan.changeIds});assert.equal(result.adopted,3);assert.equal(result.addedEntries,2);
  const after=JSON.parse(readFileSync(join(f.root,'data/cardif_public_data.json'))),engine=createKnowledgeEngine(after);
  assert.deepEqual(after.faq.slice(0,before.faq.length),before.faq);assert.deepEqual(after.services,before.services);assert.deepEqual(after.claim_document_requirements,before.claim_document_requirements);
  for(const entry of oldEngine.knowledgeEntries){assert.equal(engine.getKnowledgeEntry(entry.id).retrievedAt,entry.retrievedAt);assert.equal(engine.getKnowledgeEntry(entry.id).dateBasis,entry.dateBasis);}
  const added=engine.getKnowledgeEntry('faq:13');assert.equal(added.retrievedAt,'2026-10-21');assert.equal(added.navigationDestination.anchor,'faq-13');assert.ok(engine.verifyKnowledgeSource(engine.knowledgeSource(added)));assert.ok(engine.verifyNavigationDestination(added.navigationDestination,added.id));
  assert.equal((await publish({...f,changeIds:f.plan.changeIds})).adopted,0);
  await rollback({...f,reviewer:'FIXTURE-REVIEWER',reason:'test restore'});assert.equal(status(f.root).knowledgeVersion,f.before.knowledgeVersion);assert.equal(listReviews(f.store).find(c=>c.changeId==='append:whole').status,'APPROVED');
});
test('Revoking a paragraph approval prevents adoption of its whole-page FAQ batch',async t=>{
  const f=await appendFixture(t);await f.approveAppend();await f.approve({changeId:'append:0',status:'REJECTED',mapping:undefined});
  await assert.rejects(publish({...f,changeIds:['append:whole']}),/審核已失效/);assert.equal(status(f.root).knowledgeVersion,f.before.knowledgeVersion);
});
test('Dataset date changes cannot promote unchanged legacy dates to fresh entry dates',async t=>{
  const f=await fixture(t),before=createKnowledgeEngine(JSON.parse(readFileSync(join(f.root,'data/cardif_public_data.json'))));await f.approve();await publish({...f,synthetic:true});
  const snapshot=JSON.parse(readFileSync(join(f.root,'data/cardif_public_data.json'))),after=createKnowledgeEngine(snapshot);
  assert.equal(snapshot.meta.legacyRetrievedAt,seed.meta.crawled);assert.equal(snapshot.faq[1].retrievedAt,undefined);
  for(const entry of before.knowledgeEntries)if(entry.id!=='faq:1')assert.equal(after.getKnowledgeEntry(entry.id).retrievedAt,entry.retrievedAt);
});
test('Candidate navigation validation remains bound to canonical IDs and source fields',async t=>{
  const f=await appendFixture(t);await f.approveAppend();await publish({...f,changeIds:f.plan.changeIds});const engine=createKnowledgeEngine(JSON.parse(readFileSync(join(f.root,'data/cardif_public_data.json'))));
  const entry=engine.getKnowledgeEntry('faq:13'),source=engine.knowledgeSource(entry);assert.ok(engine.verifyKnowledgeSource(source));
  assert.equal(engine.verifyNavigationDestination({...entry.navigationDestination,anchor:'faq-9999'},entry.id),false);
  assert.equal(engine.verifyNavigationDestination({...entry.navigationDestination,source:{...entry.navigationDestination.source,url:'https://evil.invalid'}},entry.id),false);
  assert.equal(engine.verifyKnowledgeSource({...source,url:'https://evil.invalid'}),false);assert.equal(engine.verifyKnowledgeSource({...source,sourceId:'faq:14'}),false);
});
test('Pre-adoption rollback evaluates all applicable cases and explicitly reports newer source cases',async t=>{
  const f=await fixture(t),engine=createKnowledgeEngine(JSON.parse(readFileSync(join(f.root,'data/cardif_public_data.json')))),dataset=await loadKnowledgeDataset();
  const missing=dataset.filter(item=>item.requiresSourceIds?.some(id=>!engine.getKnowledgeEntry(id))).map(item=>item.id);
  const result=evaluateKnowledge(dataset,engine);assert.equal(result.failed,0);assert.deepEqual(result.skippedVersionCases,missing);assert.equal(result.total+missing.length,dataset.length);assert.ok(result.total>=111);
});
test('No remote Gemini or paid request is emitted by lifecycle tests',()=>{assert.equal(offlineNetworkStats().externalRequests,0);assert.equal(offlineNetworkStats().blockedExternalAttempts,0);});
