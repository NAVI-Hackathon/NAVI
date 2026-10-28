import {MongoClient,BSON} from 'mongodb';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createCipheriv,createDecipheriv,randomBytes,createHash,createHmac,hkdfSync,timingSafeEqual} from 'node:crypto';
import {mkdir,lstat,open,rename,unlink,readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import {ApiError} from '../middleware/errorHandler.js';
export const COLLECTIONS=Object.freeze({accounts:'users',sessions:'auth_sessions',journeys:'journeys',owners:'journey_owners',documents:'journey_documents',journey_events:'journey_events',task_batches:'task_batches',tasks:'tasks',handoff_drafts:'handoff_drafts',handoff_previews:'handoff_previews',handoff_confirmed:'handoff_confirmations',conversations:'conversations',conversation_requests:'conversation_requests',receipts:'operation_receipts',audit:'audit_events',model_health:'model_health',maintenance:'maintenance',session_issuance:'session_issuance',auth_tokens:'auth_tokens',knowledge_releases:'knowledge_releases'});
export class MongoStore {
 constructor({uri,database,key,production=false,now=Date.now}){
  if(!/^[A-Za-z0-9+/]{43}=$/.test(key??'')||!/^[a-zA-Z][a-zA-Z0-9_]{2,62}$/.test(database??'')||!/^navi(?:_|$)/.test(database))throw Error('NAVI database and independent 32-byte encryption key required');
  if(production&&(!/^mongodb\+srv:\/\//.test(uri??'')||/[?&](?:tls|ssl)=false|tlsAllowInvalid|tlsInsecure/i.test(uri)))throw Error('Production requires authenticated Atlas SRV/TLS');
  try{this.client=new MongoClient(uri,{appName:'NAVI',maxPoolSize:8,minPoolSize:0,serverSelectionTimeoutMS:5000,connectTimeoutMS:5000,socketTimeoutMS:10000,timeoutMS:10000,retryWrites:true});}catch{throw Error('Invalid private MongoDB connection configuration');}this.db=this.client.db(database);this.key=Buffer.from(key,'base64');this.now=now;this.scope=new AsyncLocalStorage();this.requestScope=new AsyncLocalStorage();
 }
 async connect(){try{await this.client.connect();const hello=await this.db.admin().command({hello:1});if(!hello.setName&&!hello.msg)throw Error('Transactions require replica set');await this.migrate();return this;}catch{await this.client.close();throw new ApiError('STORAGE_UNAVAILABLE','目前無法安全連線到服務資料庫，請稍後再試。',503,true);}}
 options(){const session=this.scope.getStore();return session?{session}:{};}
 collection(namespace){if(!COLLECTIONS[namespace])throw Error('Unknown NAVI collection');return this.db.collection(COLLECTIONS[namespace]);}
 async safe(fn){try{return await fn();}catch(e){if(e instanceof ApiError)throw e;if([11000,112].includes(e.code))throw new ApiError('JOURNEY_STALE','資料已變更或操作重複，請重新載入。',409,false);throw new ApiError('STORAGE_UNAVAILABLE','資料暫時無法保存，請稍後再試；尚未回報成功。',503,true);}}
 withSessionFence(id,fn){return this.requestScope.run(id,fn);}
 async transaction(fn){if(this.scope.getStore())return fn();return this.safe(()=>this.client.withSession(session=>session.withTransaction(()=>this.scope.run(session,async()=>{
  const id=this.requestScope.getStore();
  // Writing the session makes logout/erasure conflict with any in-flight mutation transaction.
  if(id){const touched=await this.collection('sessions').updateOne({_id:id,expiresAt:{$gt:new Date(this.now())}},{$inc:{mutationFence:1}},this.options());if(!touched.matchedCount)throw new ApiError('SESSION_EXPIRED','工作階段已結束，資料未更動。',401,false);}
  return fn();
 }),{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},maxCommitTimeMS:5000,timeoutMS:10000})));}
 aad(namespace,row){return JSON.stringify([namespace,row._id,row.ownerId,row.expiresAt.getTime(),row.revision]);}
 seal(namespace,row,value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(this.aad(namespace,row)));return Buffer.concat([iv,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]);}
 decrypt(namespace,row){try{const b=Buffer.from(row.payload.buffer??row.payload),d=createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12));d.setAAD(Buffer.from(this.aad(namespace,row)));d.setAuthTag(b.subarray(-16));return JSON.parse(Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString());}catch{throw new ApiError('DATA_INTEGRITY_ERROR','資料完整性檢查未通過，請聯絡管理員。',503,false);}}
 async get(namespace,id){return this.safe(async()=>{const row=await this.collection(namespace).findOne({_id:id,expiresAt:{$gt:new Date(this.now())}},this.options());return row?{value:this.decrypt(namespace,row),revision:row.revision,owner:row.ownerId,expires:row.expiresAt.getTime()}:null;});}
 async put(namespace,id,value,{owner='system',ttlMs=30*86400000,expectedRevision,journeyId,sessionId,updatedAt}={}){if(this.requestScope.getStore()&&!this.scope.getStore())return this.transaction(()=>this.put(namespace,id,value,{owner,ttlMs,expectedRevision,journeyId,sessionId,updatedAt}));return this.safe(async()=>{
  const old=await this.get(namespace,id),version=old?.revision??0;
  if(expectedRevision!==undefined&&expectedRevision!==version)throw new ApiError('JOURNEY_STALE','資料已在其他分頁更新，請重新載入。',409,false);
  const row={_id:id,ownerId:owner||'system',expiresAt:new Date(this.now()+ttlMs),revision:version+1,...(journeyId?{journeyId}:{}),...(sessionId?{sessionId}:{}),...(updatedAt?{updatedAt}: {})};row.payload=this.seal(namespace,row,value);
  if(old){const saved=await this.collection(namespace).replaceOne({_id:id,revision:version},row,this.options());if(!saved.modifiedCount)throw new ApiError('JOURNEY_STALE','資料已變更，請重新載入。',409,false);}else await this.collection(namespace).insertOne(row,this.options());return row.revision;
 });}
 async list(namespace,owner){return this.safe(async()=>{const rows=await this.collection(namespace).find({expiresAt:{$gt:new Date(this.now())},...(owner===undefined?{}:{ownerId:owner})},this.options()).toArray();return rows.map(row=>({id:row._id,value:this.decrypt(namespace,row),revision:row.revision,owner:row.ownerId}));});}
 async delete(namespace,id){if(this.requestScope.getStore()&&!this.scope.getStore())return this.transaction(()=>this.delete(namespace,id));return this.safe(()=>this.collection(namespace).deleteOne({_id:id},this.options()));}
 async deleteOwner(owner){return this.transaction(async()=>{for(const namespace of Object.keys(COLLECTIONS))await this.collection(namespace).deleteMany({ownerId:owner},this.options());});}
 async transferOwner(from,to,ttlMs){return this.transaction(async()=>{for(const ns of Object.keys(COLLECTIONS))for(const row of await this.list(ns,from)){if(ns==='sessions')continue;await this.put(ns,row.id,ns==='owners'?{owner:to}:row.value,{owner:to,ttlMs,expectedRevision:row.revision,journeyId:row.value.journeyId});}});}
 async cleanup(){return this.safe(async()=>{for(const name of Object.values(COLLECTIONS))await this.db.collection(name).deleteMany({expiresAt:{$lte:new Date(this.now())}});});}
 async charge(day,kind,limit,amount=1,ttlMs=90*86400000){return this.safe(async()=>{
  const c=this.db.collection('usage_budgets'),id=day+':'+kind;try{await c.updateOne({_id:id},{$setOnInsert:{used:0,day,kind,expiresAt:new Date(this.now()+ttlMs)}},{upsert:true});}catch(e){if(e.code!==11000)throw e;}
  const row=await c.findOneAndUpdate({_id:id,...(limit?{used:{$lte:limit-amount}}:{})},{$inc:{used:amount}},{returnDocument:'after'});
  if(!row)throw new ApiError(kind==='paid'?'AI_COST_LIMIT_REACHED':'AI_DAILY_LIMIT_REACHED','目前使用量已達設定預算；仍可查詢有來源的資料。',429,false);return row.used;
 });}
 async usage(day){return this.safe(()=>this.db.collection('usage_budgets').findOne({_id:day+':requests'}));}
 async audit(event,owner='system'){const allowed=Object.fromEntries(Object.entries(event).filter(([k])=>['code','operation','model','previousModel','latencyMs','status','requestId','knowledgeVersion','attempt','tokens'].includes(k)));await this.put('audit',randomBytes(16).toString('hex'),{at:new Date(this.now()).toISOString(),...allowed},{owner});}
 async health(){return this.safe(async()=>{await this.db.command({ping:1});return true;});}
 async migrate(){
  const migrations=this.db.collection('schema_migrations');if(await migrations.findOne({_id:{$gt:1}}))throw Error('Newer schema');
  for(const name of Object.values(COLLECTIONS)){
   const c=this.db.collection(name);await c.createIndex({expiresAt:1},{expireAfterSeconds:0,name:'expire_records'});await c.createIndex({ownerId:1,expiresAt:1},{name:'owner_access'});
  }
  await this.collection('journeys').createIndex({ownerId:1,updatedAt:-1,_id:-1},{name:'journey_history'});
  for(const ns of ['documents','tasks','handoff_drafts','handoff_confirmed','handoff_previews','journey_events'])await this.collection(ns).createIndex({ownerId:1,journeyId:1},{name:'journey_links'});
  await this.collection('tasks').createIndex({ownerId:1,sessionId:1},{name:'session_tasks'});
  await this.db.collection('usage_budgets').createIndex({expiresAt:1},{expireAfterSeconds:0});
  await migrations.updateOne({_id:1},{$setOnInsert:{appliedAt:new Date(),name:'encrypted_owned_product_records'}},{upsert:true});
 }
 async backup(directory){
  await mkdir(directory,{recursive:true,mode:0o700});const stat=await lstat(directory);if(stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077))throw Error('Unsafe backup directory');
  const name=`navi-mongo-${this.now()}-${randomBytes(4).toString('hex')}.jsonl`,path=join(directory,name),pending=path+'.partial',file=await open(pending,'wx',0o600);let count=0;const signature=createHmac('sha256',hkdfSync('sha256',this.key,Buffer.alloc(0),'NAVI backup v1',32));const write=async line=>{signature.update(line);await file.write(line);};
  try{await write(JSON.stringify({kind:'navi-encrypted-mongo-backup',version:1,database:this.db.databaseName,createdAt:new Date().toISOString()})+'\n');
   if(this.scope.getStore())throw Error('Backup cannot run inside a mutation transaction');
   const session=this.client.startSession();session.startTransaction({readConcern:{level:'snapshot'}});
   try{await this.scope.run(session,async()=>{for(const ns of [...Object.values(COLLECTIONS),'usage_budgets','schema_migrations'])for await(const doc of this.db.collection(ns).find({},this.options())){await write(BSON.EJSON.stringify({collection:ns,document:doc})+'\n');count++;}});}finally{await session.abortTransaction().catch(()=>{});await session.endSession();}
   await file.write(JSON.stringify({signature:signature.digest('hex')})+'\n');await file.sync();await file.close();await rename(pending,path);for(const name of await readdir(directory))if(/^navi-mongo-\d+-[a-f0-9]{8}\.jsonl$/.test(name)){const p=join(directory,name),st=await lstat(p);if(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&this.now()-st.mtimeMs>7*86400000)await unlink(p);}const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return {filename:name,sha256:hash.digest('hex'),records:count};
  }catch(e){await file.close().catch(()=>{});await unlink(pending).catch(()=>{});throw e;}
 }
 async restore(path){
  for(const ns of [...Object.values(COLLECTIONS),'usage_budgets'])if(await this.db.collection(ns).countDocuments())throw Error('Restore requires an empty dedicated NAVI target database');
  const stat=await lstat(path);if(stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.mode&0o077)throw Error('Unsafe backup');
  const signature=createHmac('sha256',hkdfSync('sha256',this.key,Buffer.alloc(0),'NAVI backup v1',32));let previous;for await(const line of createInterface({input:createReadStream(path),crlfDelay:Infinity})){if(previous!==undefined)signature.update(previous+'\n');previous=line;}const footer=JSON.parse(previous??'{}');if(!/^[a-f0-9]{64}$/.test(footer.signature??'')||!timingSafeEqual(Buffer.from(footer.signature,'hex'),signature.digest()))throw Error('Backup signature invalid');
  const allowed=new Set([...Object.values(COLLECTIONS),'usage_budgets','schema_migrations']);
  await this.transaction(async()=>{let first=true,signed=false;const currentSignature=createHmac('sha256',hkdfSync('sha256',this.key,Buffer.alloc(0),'NAVI backup v1',32));for await(const line of createInterface({input:createReadStream(path),crlfDelay:Infinity})){
   if(signed)throw new ApiError('DATA_INTEGRITY_ERROR','備份完整性檢查未通過，尚未還原任何資料。',503,false);
   if(!JSON.parse(line).signature)currentSignature.update(line+'\n');
   if(first){first=false;const h=JSON.parse(line);if(h.kind!=='navi-encrypted-mongo-backup'||h.version!==1)throw Error('Wrong backup kind');continue;}
   if(JSON.parse(line).signature){if(!timingSafeEqual(Buffer.from(JSON.parse(line).signature,'hex'),currentSignature.digest()))throw new ApiError('DATA_INTEGRITY_ERROR','備份完整性檢查未通過，尚未還原任何資料。',503,false);signed=true;continue;}const row=BSON.EJSON.parse(line);if(!allowed.has(row.collection))throw Error('Unknown backup collection');const ns=Object.keys(COLLECTIONS).find(k=>COLLECTIONS[k]===row.collection);if(ns)this.decrypt(ns,row.document);
   if(row.collection==='schema_migrations'){if(row.document._id>1)throw Error('Newer backup schema');continue;}await this.db.collection(row.collection).insertOne(row.document,this.options());
  }if(first||!signed)throw new ApiError('DATA_INTEGRITY_ERROR','備份完整性檢查未通過，尚未還原任何資料。',503,false);});return true;
 }
 async close(){if(this.closed)return;this.closed=true;await this.client.close();this.key.fill(0);}
}
