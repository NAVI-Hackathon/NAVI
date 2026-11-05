import test from 'node:test';import assert from 'node:assert/strict';import {join}from'node:path';
import {fixture,store}from'./mongoTestSupport.js';import{MongoStore}from'../src/storage/mongoStore.js';import{MongoJourneyRepository}from'../src/repositories/mongoJourneyRepository.js';
async function target(t,f){const s=await new MongoStore({...fixture(t),key:f.key}).connect();t.after(()=>s.close());return s;}
test('restoring an older backup suppresses records and owners deleted afterwards without rewinding quota or reviving sessions',async t=>{
 const f=fixture(t),s=await store(f);t.after(()=>s.close());await s.put('conversations','kept',{synthetic:'KEEP'},{owner:'owner_kept'});await s.put('conversations','deleted_record',{synthetic:'REMOVE'},{owner:'owner_kept'});await s.put('conversations','deleted_owner',{synthetic:'REMOVE'},{owner:'owner_deleted'});await s.put('sessions','old_cookie',{owner:'owner_kept'},{owner:'owner_kept'});await s.charge('test','requests',20);
 const b=await s.backup(join(f.dir,'backups'));await s.delete('conversations','deleted_record');await s.deleteOwner('owner_deleted');await s.charge('test','requests',20);
 const erasurePlan=await s.exportErasurePlan(),dest=await target(t,f);await dest.restore(join(f.dir,'backups',b.filename),{erasurePlan});assert.equal((await dest.get('conversations','kept')).value.synthetic,'KEEP');assert.equal(await dest.get('conversations','deleted_record'),null);assert.equal(await dest.get('conversations','deleted_owner'),null);assert.equal(await dest.get('sessions','old_cookie'),null);assert.equal((await dest.usage('test')).used,2);
});
test('journey deletion tombstones suppress its documents, tasks, drafts and old conversation task copies',async t=>{
 const f=fixture(t),s=await store(f);t.after(()=>s.close());const owner='SYNTHETIC_OWNER',id='SYNTHETIC_JOURNEY';await s.put('owners',id,{owner},{owner});await s.put('journeys',id,{id},{owner});
 for(const ns of ['tasks','documents','handoff_drafts'])await s.put(ns,ns,{journeyId:id},{owner,journeyId:id});
 await s.put('conversations','chat',{tasks:[{persistedTaskId:'tasks'}]},{owner});await s.put('task_batches','batch',{taskIds:['tasks']},{owner});const b=await s.backup(join(f.dir,'backups'));
 await new MongoJourneyRepository(s,86400000).deleteOwned(id,owner);const dest=await target(t,f);await dest.restore(join(f.dir,'backups',b.filename),{erasurePlan:await s.exportErasurePlan()});
 for(const ns of ['journeys','owners','documents','tasks','handoff_drafts','conversations','task_batches'])assert.equal((await dest.list(ns,owner)).length,0,ns);
});
test('restore refuses missing, stale or tampered erasure plans atomically',async t=>{
 const f=fixture(t),s=await store(f);t.after(()=>s.close());await s.put('conversations','synthetic',{}, {owner:'owner'});const b=await s.backup(join(f.dir,'backups')),file=join(f.dir,'backups',b.filename),dest=await target(t,f),plan=await s.exportErasurePlan();
 await assert.rejects(dest.restore(file),{code:'RESTORE_ERASURE_PLAN_REQUIRED'});assert.equal((await dest.list('conversations')).length,0);
 const altered=structuredClone(plan);altered.payload.records=[];altered.payload.asOf='2020-01-01T00:00:00Z';await assert.rejects(dest.restore(file,{erasurePlan:altered}),{code:'RESTORE_ERASURE_PLAN_REQUIRED'});
 const now=dest.now;dest.now=()=>now()+300001;await assert.rejects(dest.restore(file,{erasurePlan:plan}),{code:'RESTORE_ERASURE_PLAN_REQUIRED'});assert.equal((await dest.list('conversations')).length,0);
});
test('tombstones are committed with deletion and do not delete a newly re-created record version',async t=>{
 const f=fixture(t),s=await store(f);t.after(()=>s.close());await s.put('conversations','synthetic',{version:'old'},{owner:'owner'});
 await assert.rejects(s.transaction(async()=>{await s.delete('conversations','synthetic');throw Error('SYNTHETIC ROLLBACK');}));assert.equal((await s.list('erasures')).length,0);assert.ok(await s.get('conversations','synthetic'));
 await s.rememberErasure('conversations','synthetic');await s.put('conversations','synthetic',{version:'new'},{owner:'owner',expectedRevision:1});const b=await s.backup(join(f.dir,'backups')),dest=await target(t,f);await dest.restore(join(f.dir,'backups',b.filename),{erasurePlan:await s.exportErasurePlan()});assert.equal((await dest.get('conversations','synthetic')).value.version,'new');
});
test('new erasure epoch blocks old writers and refuses correctly signed pre-epoch backups',async t=>{
 const {readFileSync,writeFileSync}=await import('node:fs');
 const {createHmac,hkdfSync}=await import('node:crypto');
 const f=fixture(t),s=await store(f);t.after(()=>s.close());
 await s.put('conversations','old_record',{text:'TEST ONLY'},{owner:'guest'});
 const old=await s.backup(join(f.dir,'backups')),file=join(f.dir,'backups',old.filename);
 const [header,...rows]=readFileSync(file,'utf8').trimEnd().split('\n');rows.pop();
 const {epoch,...legacyHeader}=JSON.parse(header);
 const contents=[JSON.stringify({...legacyHeader,version:1}),...rows].join('\n')+'\n';
 const signature=createHmac('sha256',hkdfSync('sha256',s.key,Buffer.alloc(0),'NAVI backup v1',32)).update(contents).digest('hex');
 writeFileSync(file,contents+JSON.stringify({signature})+'\n');
 class LegacyWriter extends MongoStore {
  async migrate(){if(await this.db.collection('schema_migrations').findOne({_id:{$gt:1}}))throw Error('Newer schema');}
 }
 await assert.rejects(new LegacyWriter(f).connect(),{code:'STORAGE_UNAVAILABLE'});
 await s.delete('conversations','old_record');
 const dest=await target(t,f);
 await assert.rejects(dest.restore(file,{erasurePlan:await s.exportErasurePlan()}),{code:'RESTORE_ERASURE_PLAN_REQUIRED'});
 assert.equal(await dest.get('conversations','old_record'),null);
 await s.put('conversations','keep',{text:'TEST ONLY'},{owner:'account'});
 const fresh=await s.backup(join(f.dir,'backups'));
 await dest.restore(join(f.dir,'backups',fresh.filename),{erasurePlan:await s.exportErasurePlan()});
 assert.ok(await dest.get('conversations','keep'));
 assert.equal(await dest.get('conversations','old_record'),null);
});

for(const erase of ['journey','account'])test(`guest transfer and ${erase} erasure cannot restore the original guest data`,async t=>{
 const f=fixture(t),s=await store(f);t.after(()=>s.close());
 const guest='guest_test',account='account_test',id='journey_test',dir=join(f.dir,'backups');
 await s.put('owners',id,{owner:guest},{owner:guest});
 await s.put('journeys',id,{id},{owner:guest,updatedAt:'2026-10-27T00:00:00.000Z'});
 for(const ns of ['tasks','documents','handoff_drafts'])await s.put(ns,ns,{journeyId:id},{owner:guest,journeyId:id,sessionId:'test_session'});
 await s.put('conversations','linked_chat',{tasks:[{persistedTaskId:'tasks'}]},{owner:guest});
 await s.put('task_batches','linked_batch',{taskIds:['tasks']},{owner:guest});
 const before=await s.backup(dir);
 await assert.rejects(s.transaction(async()=>{await s.transferOwner(guest,account,86400000);throw Error('TEST ROLLBACK');}));
 assert.equal((await s.get('journeys',id)).owner,guest);
 assert.equal((await s.list('erasures')).length,0);
 await s.transferOwner(guest,account,86400000);
 assert.equal((await s.get('journeys',id)).owner,account);
 assert.equal((await s.collection('journeys').findOne({_id:id})).updatedAt,'2026-10-27T00:00:00.000Z');
 assert.equal((await s.collection('tasks').findOne({_id:'tasks'})).sessionId,'test_session');
 const after=await s.backup(dir);
 if(erase==='account')await s.deleteOwner(account);
 else await new MongoJourneyRepository(s,86400000).deleteOwned(id,account);
 for(const snapshot of [before,after]){
  const dest=await target(t,f);
  await dest.restore(join(dir,snapshot.filename),{erasurePlan:await s.exportErasurePlan()});
  for(const ns of ['journeys','owners','documents','tasks','handoff_drafts','conversations','task_batches'])assert.equal((await dest.list(ns)).length,0,ns);
 }
});
