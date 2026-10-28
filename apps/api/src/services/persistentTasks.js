import {randomUUID,createHash} from 'node:crypto';
import {getKnowledgeVersion} from './knowledgeVersionService.js';
import {ApiError} from '../middleware/errorHandler.js';
import {redactIdentifiers} from '../utils/privacy.js';
export function createPersistentTasks({store,config,sessions,service}){
 return {
  async save(req,result){const s=await sessions.session(req),batchId=randomUUID(),now=new Date().toISOString(),version=getKnowledgeVersion().knowledgeVersion;return store.transaction(async()=>{
   const tasks=[];for(const task of result.tasks){const taskId=randomUUID(),value={taskId,batchId,sessionId:s.id,input:redactIdentifiers(task.input),summary:task.data.summary,data:task.data,serviceType:task.data.serviceType,status:'pending',createdAt:now,updatedAt:now,knowledgeVersion:version,provider:result.provider,plannedJourneyId:randomUUID()};await store.put('tasks',taskId,value,{owner:s.owner,ttlMs:config.dataRetentionMs,sessionId:s.id});tasks.push({...task,persistedTaskId:taskId});}
   await store.put('task_batches',batchId,{batchId,taskIds:tasks.map(t=>t.persistedTaskId),knowledgeVersion:version,createdAt:now},{owner:s.owner,ttlMs:config.dataRetentionMs,sessionId:s.id});return {...result,batchId,tasks};
  });},
  async list(req,account=false){const s=await sessions.requireAccount(req);return {tasks:(await store.list('tasks',s.owner)).filter(r=>account||r.value.sessionId===s.id).map(r=>{const {data,plannedJourneyId,provider,...publicTask}=r.value;return {...publicTask,version:r.revision};})};},
  async create(req,{taskId,idempotencyKey}){
   const s=await sessions.requireAccount(req),key=createHash('sha256').update(s.owner+':'+idempotencyKey).digest('hex');
   const row=await store.get('tasks',taskId);if(!row||row.owner!==s.owner)throw new ApiError('TASK_NOT_FOUND','找不到這項任務。',404,false);const task=row.value;
   if(task.knowledgeVersion!==getKnowledgeVersion().knowledgeVersion)throw new ApiError('TASK_STALE','來源版本已更新，請重新確認服務需求。',409,false);
   if(task.data.confidence<config.confidenceThreshold||task.serviceType==='unknown')throw new ApiError('TASK_STALE','請先補充或確認需求，再開始旅程。',409,false);
   const op=await store.get('receipts',key);if(op&&op.value.taskId!==taskId)throw new ApiError('IDEMPOTENCY_CONFLICT','相同操作編號不能用於不同任務。',409,false);
   await store.transaction(async()=>{await sessions.requireAccount(req);await store.put('receipts',key,{taskId,journeyId:task.plannedJourneyId},{owner:s.owner,ttlMs:300000});await store.put('owners',task.plannedJourneyId,{owner:s.owner},{owner:s.owner,ttlMs:config.dataRetentionMs});});
   const j=await service.create({message:task.input},undefined,task.data,task.plannedJourneyId);
   await store.transaction(async()=>{await sessions.requireAccount(req);const latest=await store.get('tasks',taskId);if(!latest||latest.owner!==s.owner)throw new ApiError('TASK_NOT_FOUND','任務已刪除。',404,false);await store.put('tasks',taskId,{...latest.value,status:j.currentStage==='READY_TO_PROCEED'?'completed':'in_progress',journeyId:j.id,updatedAt:new Date().toISOString()},{owner:s.owner,ttlMs:config.dataRetentionMs,journeyId:j.id,sessionId:s.id,expectedRevision:latest.revision});});return j;
  },
 };
}
