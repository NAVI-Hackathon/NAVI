import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeStore, bootstrap, importCandidates, listReviews, decide, publish, rollback, sha256 } from './lifecycle.js';
import { createKnowledgeEngine } from '../../shared/knowledge/index.js';

export async function runDemonstration({ directory = mkdtempSync(join(tmpdir(), 'navi-knowledge-demo-')) } = {}) {
  if (readdirSync(directory).length) throw Error('Synthetic demonstration requires an empty isolated directory');
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  mkdirSync(join(directory,'data'),{recursive:true});
  const seed = JSON.parse(readFileSync(join(repo,'data/cardif_public_data.json'),'utf8'));
  delete seed.meta.knowledgeVersion;
  writeFileSync(join(directory,'data/cardif_seed_data.json'),JSON.stringify(seed));
  writeFileSync(join(directory,'data/cardif_public_data.json'),JSON.stringify(seed));
  writeFileSync(join(directory,'.synthetic-knowledge-demo'),'Synthetic Knowledge lifecycle demonstration only\n');
  const store=join(directory,'private'),{tokenFile}=initializeStore(store);
  const before=await bootstrap({root:directory,store,tokenFile});
  const original=seed.faq[0], next=original.a+'\n合成測試：NAVI-LIFECYCLE-LOCAL-ONLY，非官方新增規定。';
  const paragraph={id:'demo-paragraph-address',text:next,sha256:sha256(next)};
  const candidate={changeId:'demo:faq-update',sourceId:'demo:source',sourceUrl:original.source,retrievedAt:new Date().toISOString(),category:'Modified',old:{id:'demo-paragraph-address',text:original.a,sha256:sha256(original.a)},new:paragraph,knowledgeIds:['faq:1'],navigationTargets:[]};
  const page={sourceUrl:original.source,extractionStatus:'ok',content_md:next,normalizedContentSha256:sha256(next),rawContentSha256:sha256('<synthetic>'+next+'</synthetic>')};
  const imported=await importCandidates({store,tokenFile,report:{changes:[candidate]},pages:[page]});
  const pending=listReviews(store)[0].status;
  await decide({root:directory,store,tokenFile,changeId:candidate.changeId,status:'APPROVED',reviewer:'LOCAL-SYNTHETIC-DEMO',reason:'本機合成資料展示，非真人核准官方內容',mapping:{sourceId:'faq:1',field:'a',value:next,entryReviewed:true,workflowCompatibility:'reviewed_no_rule_change'},synthetic:true});
  const released=await publish({root:directory,store,tokenFile,changeIds:[candidate.changeId],synthetic:true});
  const snapshot=JSON.parse(readFileSync(join(directory,'data/cardif_public_data.json'),'utf8'));
  const engine=createKnowledgeEngine(snapshot);
  const result=engine.searchKnowledge('faq:1').results[0];
  if(!result.content.includes('NAVI-LIFECYCLE-LOCAL-ONLY') || result.sourceType!=='synthetic_demo') throw Error('Demo retrieval did not use the published synthetic version');
  const source=engine.knowledgeSource(result);
  const restored=await rollback({root:directory,store,tokenFile,reviewer:'LOCAL-SYNTHETIC-DEMO',reason:'展示完成，恢復原版本'});
  const rolled=JSON.parse(readFileSync(join(directory,'data/cardif_public_data.json'),'utf8'));
  if(createKnowledgeEngine(rolled).getKnowledgeEntry('faq:1').content.includes('NAVI-LIFECYCLE-LOCAL-ONLY')) throw Error('Rollback did not restore retrieval');
  return {syntheticDemo:true,productionKnowledgeChanged:false,directory,before:before.knowledgeVersion,imported,pending,decision:'APPROVED (synthetic local actor only)',published:released.knowledgeVersion,search:{sourceId:result.id,knowledgeVersion:result.knowledgeVersion,sourceType:result.sourceType,excerpt:result.content,source,verified:next.split('\n').every(line=>engine.verifyEvidenceSnippet(result.id,line))},rollback:restored.knowledgeVersion,auditPreserved:listReviews(store)[0].status==='APPROVED',liveGeminiRequests:0,paidApiCalls:0};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=await runDemonstration();
  const out=resolve('artifacts/knowledge-lifecycle');mkdirSync(out,{recursive:true});writeFileSync(join(out,'demonstration.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}
