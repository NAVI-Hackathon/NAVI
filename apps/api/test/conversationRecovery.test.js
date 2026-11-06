import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createConversationService } from '../src/services/conversationService.js';
import { createDemoProvider } from '../src/ai/demoProvider.js';
import { ApiError } from '../src/middleware/errorHandler.js';
import { fixture, store } from './mongoTestSupport.js';

const owner = 'synthetic-conversation-owner';
const message = '我要修改通訊地址';
const hash = createHash('sha256').update(message).digest('hex');
const config = { productMode: true, requestTimeoutMs: 2000, confidenceThreshold: .65, dataRetentionMs: 3600000 };
const demo = createDemoProvider();
const valid = async text => ({
  ...await demo.understandTasks(text),
  answer: { answer:'目前提供的資料不足以確認。', sourceIds:[], confidence:0, supported:false },
});
async function setup(t, converse = valid) {
  const db = await store(fixture(t));
  t.after(() => db.close());
  const service = () => createConversationService({config, provider:{mode:'live',converse}, store:db});
  const sessions = {
    session: async () => ({owner}),
    remember: async (_req, _input, _data, id) => db.put('receipts',id,{saved:true},{owner}),
  };
  const send = (instance, input, signal) => instance.send(input,owner,sessions,{},signal);
  return {db,service,send};
}

test('conversation recovery validates payload before replay and reclaims only expired fenced work', async t => {
  let calls=0;
  const {db,service,send}=await setup(t,async text=>{calls++;return valid(text);});
  const input={requestId:randomUUID(),message};
  const conversationId=randomUUID(),key=owner+':'+input.requestId;
  const claim={processing:true,messageHash:hash,conversationId,leaseUntil:Date.now()+60000};
  const revision=await db.put('conversation_requests',key,claim,{owner});
  await assert.rejects(send(service(),{...input,message:'另一件事'}),{code:'IDEMPOTENCY_CONFLICT'});
  await assert.rejects(send(service(),input),{code:'CONVERSATION_BUSY'});
  await db.put('conversation_requests',key,{...claim,leaseUntil:0},{owner,expectedRevision:revision});
  const result=await send(service(),input);
  assert.equal(result.conversationId,conversationId);
  assert.equal(result.mode,'live');
  assert.deepEqual(await send(service(),input),result);
  assert.equal(calls,1);
  assert.equal((await db.list('conversations',owner)).length,1);
  assert.equal((await db.list('receipts',owner)).length,1);
});

test('a cancelled request releases its reservation and concurrent replay commits one result', async t => {
  let calls=0, started;
  const wait=new Promise(resolve=>{started=resolve;});
  const {db,service,send}=await setup(t,async text=>{
    if(++calls===1){started();return new Promise(()=>{});}
    return valid(text);
  });
  const input={requestId:randomUUID(),message};
  const controller=new AbortController(),first=send(service(),input,controller.signal);
  await wait;
  controller.abort();
  await assert.rejects(first,{code:'REQUEST_CANCELLED'});
  assert.equal((await db.list('conversations',owner)).length,0);
  const instance=service();
  const results=await Promise.all([send(instance,input),send(instance,input)]);
  assert.deepEqual(results[0],results[1]);
  assert.equal(calls,2);
  assert.equal((await db.list('conversations',owner)).length,1);
});

test('a storage failure rolls back receipt and conversation writes and permits a same-ID manual retry', async t => {
  const {db,service,send}=await setup(t);
  const original=db.put.bind(db);
  const input={requestId:randomUUID(),message};
  let fail=true;
  db.put=async (ns,id,value,options)=>{
    if(fail&&ns==='conversation_requests'&&value.reply){fail=false;throw new ApiError('STORAGE_UNAVAILABLE','合成故障',503,true);}
    return original(ns,id,value,options);
  };
  await assert.rejects(send(service(),input),{code:'STORAGE_UNAVAILABLE'});
  assert.equal((await db.list('conversations',owner)).length,0);
  assert.equal((await db.list('receipts',owner)).length,0);
  const result=await send(service(),input);
  assert.equal(result.mode,'live');
  assert.equal((await db.list('conversations',owner)).length,1);
  assert.equal((await db.list('receipts',owner)).length,1);
});

test('a partial provider response preserves grounded retrieval without creating tasks', async t => {
  const {db,service,send}=await setup(t,async()=>({tasks:[]}));
  const input={requestId:randomUUID(),message};
  const result=await send(service(),input);
  assert.equal(result.errorCode,'AI_RESPONSE_INVALID');
  assert.equal(result.mode,'retrieval');
  assert.equal(result.understanding,null);
  assert.equal((await db.list('receipts',owner)).length,0);
  assert.deepEqual(await send(service(),input),result);
});

test('an unspecified data change asks for the service before invoking the model', async t => {
  const {service,send}=await setup(t,async()=>assert.fail('ambiguous input must not invoke generation'));
  const result=await send(service(),{requestId:randomUUID(),message:'我要改資料。'});
  assert.equal(result.clarification.reason,'service_unspecified');
  assert.equal(result.mode,'retrieval');
  assert.equal(result.understanding,null);
});
