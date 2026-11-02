import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {MongoStore} from '../src/storage/mongoStore.js';
import {samplePdf} from './sampleDocuments.js';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {createDemoProvider} from '../src/ai/demoProvider.js';
import {ConversationReplySchema} from '../../../shared/product.js';
import {fixture,store,config} from './mongoTestSupport.js';
const origin='https://app.navitw.com';
async function setup(t,converse){
 const f=fixture(t),c=config(f);c.store=await store(f);let calls=0;
 const app=createApp(c,{...createDemoProvider(),mode:'live',converse:async(...args)=>{calls++;return converse(...args);}}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await app.locals.close();});let cookie='';
 async function call(path,body,method=body?'POST':'GET'){const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{Origin:origin,Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});cookie=r.headers.get('set-cookie')?.split(';')[0]??cookie;return {status:r.status,body:await r.json(),mode:r.headers.get('X-NAVI-AI-Mode')};}
 await call('/session');await call('/session/consent',{syntheticOnly:true,disclosureVersion:'gemini-unpaid-2026-10'});
 return {fixture:f,async upload(id,type,bytes=samplePdf(type)){const form=new FormData();form.set('file',new Blob([bytes],{type:'application/pdf'}),'synthetic.pdf');form.set('documentType',type);const r=await fetch(`http://127.0.0.1:${server.address().port}/api/journeys/${id}/documents`,{method:'POST',headers:{Origin:origin,Cookie:cookie},body:form});return {status:r.status,body:await r.json()};},call,store:c.store,get calls(){return calls;},send:async message=>call('/conversations/messages',{message,requestId:randomUUID()})};
}
for(const [code,retryable]of [['AI_PROVIDER_ERROR',true],['AI_TIMEOUT',true],['AI_BUSY',true],['AI_DAILY_LIMIT_REACHED',false],['AI_USAGE_UNAVAILABLE',true]])test('retrieval-only contract preserves provider failure: '+code,async t=>{
 const a=await setup(t,()=>{throw Object.assign(new Error('PRIVATE_PROVIDER_PAYLOAD'),{code});});
 const r=await a.send('我要變更保費付款方式。');assert.equal(r.status,200);ConversationReplySchema.parse(r.body);assert.equal(r.body.understanding,null);assert.equal(r.body.mode,'retrieval');assert.equal(r.body.errorCode,code);assert.equal(r.body.failure.retryable,retryable);assert.equal(r.mode,'live');assert.equal(r.body.evidence.results[0].source.id,'service:change_payment_method');assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE_PROVIDER_PAYLOAD|demo_fallback/);assert.equal(a.calls,1);
});
test('clarification and refusal do not invoke a provider or persist guessed tasks',async t=>{
 const a=await setup(t,()=>{throw new Error('must not call');});
 for(const message of ['我不知道要辦什麼。','我要申請理賠，可是忘記日期。','幫我保證一定可以理賠。']){const r=await a.send(message);assert.equal(r.status,200);ConversationReplySchema.parse(r.body);assert.equal(r.body.understanding,null);assert.equal(r.body.errorCode,null);assert.equal(r.body.mode,'retrieval');assert.equal(r.body.clarification.blocking,true);assert.equal(r.body.answer,r.body.clarification.question);assert.deepEqual(r.body.evidence.results,[]);}
 assert.equal(a.calls,0);assert.equal((await a.store.list('tasks')).length,0);assert.equal((await a.store.list('journeys')).length,0);
});
test('empty evidence remains a valid failure response and never claims Live success',async t=>{
 const a=await setup(t,()=>{throw Object.assign(Error('RAW'),{code:'AI_UNAVAILABLE'});}),r=await a.send('土星導航演唱會');assert.equal(r.body.evidence.status,'not_found');assert.equal(r.body.mode,'retrieval');assert.equal(r.body.understanding,null);assert.equal(r.body.failure.code,'AI_UNAVAILABLE');ConversationReplySchema.parse(r.body);
});
test('grounding failure clears partial model tasks rather than saving a false AI success',async t=>{
 const demo=createDemoProvider(),a=await setup(t,async message=>({...await demo.understandTasks(message),answer:{answer:'虛構給付規則',sourceIds:['service:change_address'],supported:true,confidence:.99}}));
 const r=await a.send('我要改通訊地址');assert.equal(r.status,200);assert.equal(r.body.errorCode,'AI_RESPONSE_INVALID');assert.equal(r.body.mode,'retrieval');assert.equal(r.body.understanding,null);assert.equal((await a.store.list('tasks')).length,0);ConversationReplySchema.parse(r.body);
});
test('valid extracted answer and task keep their existing successful schema',async t=>{
 const demo=createDemoProvider(),a=await setup(t,async(message,context,sources)=>({...await demo.understandTasks(message),answer:{answer:sources[0].content,sourceIds:[sources[0].id],supported:true,confidence:.9}}));
 const r=await a.send('我要改通訊地址');assert.equal(r.status,200);assert.equal(r.body.mode,'live');assert.equal(r.body.errorCode,null);assert.ok(r.body.understanding.tasks.length);assert.equal(r.body.failure,undefined);ConversationReplySchema.parse(r.body);
});
test('evidence HTTP endpoint and search return the same subject and exact verified destination',async t=>{
 const a=await setup(t,()=>{});for(const [query,id,anchor]of[['我要變更保費付款方式。','service:change_payment_method','service-change-payment-method'],['我要改紅利給付方式','service:change_dividend_option','service-change-dividend-option']]){const r=await a.call('/knowledge/evidence?query='+encodeURIComponent(query));assert.equal(r.status,200);assert.equal(r.body.results[0].source.id,id);assert.equal(r.body.results[0].source.navigationDestination.anchor,anchor);}
});

test('hospital fields, channels and readiness stay server-owned across upload, replacement, deletion and reload',async t=>{
 const a=await setup(t,()=>{});let j=(await a.call('/journeys',{message:'我在台中榮總住院五天'})).body;
 assert.equal(j.readiness,35);assert.equal(j.extractedData.hospitalName,'台中榮總');
 let r=await a.upload(j.id,'diagnosis_certificate');assert.equal(r.status,200);j=r.body.journey;assert.equal(j.readiness,70);const firstDiagnosis=r.body.document.id;
 r=await a.upload(j.id,'bank_passbook');assert.equal(r.status,200);j=r.body.journey;assert.equal(j.readiness,90);const passbook=r.body.document.id;
 j=(await a.call('/journeys/'+j.id+'/review',{confirmed:true})).body;assert.equal(j.readiness,100);
 j=(await a.call('/journeys/'+j.id)).body;assert.equal(j.readiness,100);assert.ok(j.documents.every(d=>d.verification.authenticity==='not_assessed'));assert.ok(j.claimContext.channels.every(c=>c.eligibility.status!=='eligible'));
 const snapshot=await a.store.backup(join(a.fixture.dir,'backups'));
 // The DELETE request uses the actual persisted repository and revokes confirmation.
 j=(await a.call('/journeys/'+j.id+'/documents/'+passbook,null,'DELETE')).body;assert.equal(j.readiness,70);assert.equal(j.confirmed,false);
 r=await a.upload(j.id,'diagnosis_certificate');assert.equal(r.status,200);assert.ok(r.body.journey.documents.some(d=>d.id===firstDiagnosis));
 r=await a.upload(j.id,'diagnosis_certificate',Buffer.concat([samplePdf('diagnosis_certificate'),Buffer.from('\n% SYNTHETIC REPLACEMENT TEST ONLY\n')]));assert.equal(r.status,200);j=r.body.journey;assert.equal(j.readiness,70);assert.ok(!j.documents.some(d=>d.id===firstDiagnosis));
 const reloaded=(await a.call('/journeys/'+j.id)).body;assert.deepEqual(reloaded,j);
 const dest=await new MongoStore({...fixture(t),key:a.fixture.key}).connect();t.after(()=>dest.close());await dest.restore(join(a.fixture.dir,'backups',snapshot.filename),{erasurePlan:await a.store.exportErasurePlan()});assert.equal(await dest.get('journeys',j.id),null);assert.equal((await dest.list('documents')).length,0);
});
