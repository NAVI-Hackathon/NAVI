import {randomUUID} from 'node:crypto';
import {ServiceJourneySchema} from '../../../../shared/journey.js';
import {ApiError} from '../middleware/errorHandler.js';
export class MongoJourneyRepository {
 constructor(store,ttlMs){this.store=store;this.ttlMs=ttlMs;}
 async get(id){const row=await this.store.get('journeys',id);return row?ServiceJourneySchema.parse({...row.value,revision:row.revision}):null;}
 async save(journey){return this.store.transaction(async()=>{
  const owner=(await this.store.get('owners',journey.id))?.value.owner;if(!owner)throw new ApiError('AUTH_REQUIRED','請先登入或重新啟用工作階段。',401,false);
  const parsed=ServiceJourneySchema.parse(journey),revision=await this.store.put('journeys',journey.id,parsed,{owner,ttlMs:this.ttlMs,expectedRevision:journey.revision??0,updatedAt:journey.updatedAt});
  for(const row of await this.store.list('documents',owner))if(row.value.journeyId===journey.id&&!journey.documents.some(d=>d.id===row.id))await this.store.delete('documents',row.id);
  for(const doc of journey.documents)await this.store.put('documents',doc.id,{journeyId:journey.id,document:doc},{owner,ttlMs:this.ttlMs,journeyId:journey.id});
  for(const task of await this.store.list('tasks',owner))if(task.value.journeyId===journey.id)await this.store.put('tasks',task.id,{...task.value,status:journey.currentStage==='READY_TO_PROCEED'?'completed':journey.supported?'in_progress':'requires_confirmation',updatedAt:journey.updatedAt},{owner,ttlMs:this.ttlMs,journeyId:journey.id,sessionId:task.value.sessionId,expectedRevision:task.revision});
  await this.store.put('owners',journey.id,{owner},{owner,ttlMs:this.ttlMs});await this.store.put('journey_events',randomUUID(),{journeyId:journey.id,readiness:journey.readiness,currentStage:journey.currentStage,at:new Date().toISOString()},{owner,ttlMs:this.ttlMs,journeyId:journey.id});return {...parsed,revision};
 });}
 async delete(id){await this.store.delete('journeys',id);}
 async deleteOwned(id,owner){return this.store.transaction(async()=>{
  if((await this.store.get('owners',id))?.value.owner!==owner)throw new ApiError('JOURNEY_NOT_FOUND','找不到這份服務歷程。',404,false);
  const removedTasks=(await this.store.list('tasks',owner)).filter(r=>r.value.journeyId===id).map(r=>r.id);
  for(const ns of ['documents','handoff_drafts','handoff_previews','handoff_confirmed','journey_events','tasks','receipts'])for(const row of await this.store.list(ns,owner))if(row.value.journeyId===id||row.value.plannedJourneyId===id||row.value.preview?.journeyId===id)await this.store.delete(ns,row.id);
  for(const batch of await this.store.list('task_batches',owner)){const taskIds=batch.value.taskIds.filter(t=>!removedTasks.includes(t));if(taskIds.length!==batch.value.taskIds.length){if(taskIds.length)await this.store.put('task_batches',batch.id,{...batch.value,taskIds},{owner,ttlMs:this.ttlMs,expectedRevision:batch.revision});else await this.store.delete('task_batches',batch.id);}}
  for(const conversation of await this.store.list('conversations',owner)){const tasks=(conversation.value.tasks??[]).filter(t=>!removedTasks.includes(t.persistedTaskId));if(tasks.length!==conversation.value.tasks.length)await this.store.put('conversations',conversation.id,{...conversation.value,tasks},{owner,ttlMs:this.ttlMs,expectedRevision:conversation.revision});}
  for(const reply of await this.store.list('conversation_requests',owner))if(reply.value.reply?.understanding?.tasks.some(t=>removedTasks.includes(t.persistedTaskId)))await this.store.delete('conversation_requests',reply.id);
  await this.store.delete('journeys',id);await this.store.delete('owners',id);return {deleted:true,id,deletedAt:new Date().toISOString()};
 });}
}
