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
