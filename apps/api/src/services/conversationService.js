import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TaskUnderstandingSchema } from '../../../../shared/serviceTasks.js';
import { ConversationReplySchema } from '../../../../shared/product.js';
import { searchVerifiedKnowledge } from '../../../../shared/knowledge/evidence.js';
import { validateGroundedAnswer, INSUFFICIENT_ANSWER } from './knowledgeAnswerService.js';
import { GroundedAnswerSchema } from '../ai/schemas.js';
import { ProviderTasksSchema, understandTasks } from './taskService.js';
import { getKnowledgeVersion } from './knowledgeVersionService.js';
import { requestValidatedAI } from './providerRequest.js';
import { ApiError } from '../middleware/errorHandler.js';
import { redactIdentifiers } from '../utils/privacy.js';

export const ConversationGenerationSchema=ProviderTasksSchema.extend({answer:GroundedAnswerSchema});
export function createConversationService({config,provider,store}) {
  const pending=new Map();
  async function get(id,owner){const row=await store.get('conversations',id);if(!row||row.owner!==owner)throw new ApiError('CONVERSATION_NOT_FOUND','找不到這段對話，請在原登入狀態開啟。',404,false);return row;}
  async function list(owner){return (await store.list('conversations',owner)).map(({id,value})=>({id,updatedAt:value.updatedAt,preview:value.messages.at(-1)?.text.slice(0,100)??''}));}
  async function send(input,owner,sessions,req,signal) {
    let row=input.conversationId?await get(input.conversationId,owner):null;
    const id=input.conversationId??randomUUID(),key=owner+':'+input.requestId;
    if(pending.has(key)){const p=pending.get(key);if(p.hash!==hashMessage(input.message)||input.conversationId&&p.id!==input.conversationId)throw new ApiError('IDEMPOTENCY_CONFLICT','相同操作編號的內容不一致。',409,false);return p.promise;}
    const previous=(await store.get('conversation_requests',key))?.value;
    if(previous){if(previous.processing)throw new ApiError('CONVERSATION_INCOMPLETE','上次操作尚未確認完成，請從已保存任務或歷程繼續；沒有自動重送 AI。',409,false);if(previous.messageHash!==hashMessage(input.message)||previous.conversationId!==(input.conversationId??previous.conversationId))throw new ApiError('IDEMPOTENCY_CONFLICT','相同操作編號的內容不一致。',409,false);return previous.reply;}

    if(pending.has(id))throw new ApiError('CONVERSATION_BUSY','這段對話仍在處理上一項需求，請稍候。',409,true);
    const work=(async()=>{
      const reservation=await store.put('conversation_requests',key,{processing:true,messageHash:hashMessage(input.message),conversationId:id},{owner,expectedRevision:0,ttlMs:config.dataRetentionMs});
      const state=row?.value??{id,messages:[],tasks:[],updatedAt:new Date().toISOString()};
      const last=state.tasks.find(t=>t.data.serviceType!=='unknown');
      const continuation=/^(那|這|請問需要|需要哪些|要哪些|還要|然後|為什麼|how|what about)/i.test(input.message);
      const query=continuation&&last?`${last.data.summary} ${input.message}`:input.message;
      const evidence=searchVerifiedKnowledge(query);
      const context={tasks:state.tasks.map(({input:_,...task})=>task)};
      const sources=evidence.results.map(e=>({id:e.source.id,content:e.excerpts.join('\n')}));
      const answerContext={answer:sources.map(s=>s.content).join('\n'),sourceIds:sources.map(s=>s.id),sources};
      let understanding=null,answer=INSUFFICIENT_ANSWER,errorCode=null,mode='retrieval';
      if(evidence.status==='out_of_scope')answer='NAVI 可以協助查詢流程與準備資料，但不提供投保建議或判斷能否理賠；請由專員確認。';
      else try {
        if(!provider.converse)throw new ApiError('AI_UNAVAILABLE','對話模型目前無法使用。',503,true);
        const raw=await requestValidatedAI(s=>provider.converse(input.message,context,sources,s),{config,signal});
        const parsed=ConversationGenerationSchema.parse(raw);
        understanding=await understandTasks(input.message,{config,signal,provider:{...provider,understandTasks:async()=>({tasks:parsed.tasks})}});
        const grounded=validateGroundedAnswer(parsed.answer,answerContext);
        answer=grounded.supported?grounded.answer:understanding.tasks.some(t=>t.outcome==='clarification')?'可以再說明你想處理的事情嗎？例如地址變更、查詢表單或醫療理賠資料準備。':'請選擇要處理的需求；服務條件仍需依來源與實際情況確認。';mode='live';
      }catch(error){if(signal?.aborted)throw error;errorCode=error.code??'AI_RESPONSE_INVALID';answer=answerContext.answer||'目前 AI 暫時無法回應。你仍可查詢服務資料，或補充希望辦理的事項。';}
      if(understanding){if(config.tasks)understanding=await config.tasks.save(req,understanding);for(const t of understanding.tasks)await sessions.remember(req,t.input,t.data,t.id);state.tasks=mergeTasks(state.tasks,understanding.tasks);}
      // Keep neutral service facts, not the free-text clinical description, in recoverable history.
      const note=understanding?.tasks.map(t=>t.data.summary).join('；')??(evidence.status==='answered'?'使用者查詢服務資訊。':'使用者希望補充服務需求。');
      state.messages=[...state.messages,{role:'user',text:redactIdentifiers(note),at:new Date().toISOString()},{role:'assistant',text:answer,at:new Date().toISOString()}].slice(-60);
      state.updatedAt=new Date().toISOString();
      const reply=ConversationReplySchema.parse({conversationId:id,messages:state.messages,understanding,answer,evidence,mode,errorCode,knowledgeVersion:getKnowledgeVersion().knowledgeVersion});
      await store.transaction(async()=>{await sessions.session(req);await store.put('conversations',id,state,{owner,ttlMs:config.dataRetentionMs,expectedRevision:row?.revision??0});await store.put('conversation_requests',key,{reply,messageHash:hashMessage(input.message),conversationId:id},{owner,ttlMs:config.dataRetentionMs,expectedRevision:reservation});});return reply;
    })().finally(()=>{pending.delete(key);pending.delete(id);});pending.set(key,{promise:work,hash:hashMessage(input.message),id});pending.set(id,true);return work;
  }
  return {get,list,send};
}
import { createHash } from 'node:crypto';
const hashMessage=s=>createHash('sha256').update(s).digest('hex');
function mergeTasks(previous,current){const corrected=current.some(t=>t.input.includes('不是')||t.input.includes('其實'));const base=corrected?previous.filter(t=>t.data.serviceType!=='hospitalization_claim'):previous;return [...base.filter(t=>!current.some(c=>c.data.serviceType===t.data.serviceType)),...current].slice(-12);}
