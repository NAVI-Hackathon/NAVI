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
  function send(input,owner,sessions,req,signal) {
    const hash=hashMessage(input.message),key=owner+':'+input.requestId;
    const inFlight=pending.get(key);
    if(inFlight){
      if(inFlight.hash!==hash||(input.conversationId&&inFlight.id!==input.conversationId))throw idempotencyConflict();
      return inFlight.promise;
    }
    const entry={hash,id:input.conversationId??randomUUID()};
    // Publish the local lock before the first asynchronous store lookup.
    entry.promise=processRequest(entry,key,input,owner,sessions,req,signal).finally(()=>pending.delete(key));
    pending.set(key,entry);
    return entry.promise;
  }
  async function processRequest(entry,key,input,owner,sessions,req,signal){
    const previous=await store.get('conversation_requests',key);
    if(previous){
      const value=previous.value;
      if(previous.owner!==owner||value.messageHash!==entry.hash||(input.conversationId&&value.conversationId!==input.conversationId))throw idempotencyConflict();
      if(!value.processing){
        if(input.conversationId)await get(input.conversationId,owner);
        return value.reply;
      }
      // Old reservations may have committed separate task writes. Only fenced requests can be retried safely.
      if(!Number.isSafeInteger(value.leaseUntil))throw new ApiError('CONVERSATION_INCOMPLETE','上次操作的結果未確認。請從已保存任務或歷程繼續，或以新訊息開始。',409,false);
      if(value.leaseUntil>Date.now())throw new ApiError('CONVERSATION_BUSY','這段對話仍在處理上一項需求，請稍候。',409,true);
      entry.id=value.conversationId;
    }
    const id=entry.id;
    if(pending.has(id))throw new ApiError('CONVERSATION_BUSY','這段對話仍在處理上一項需求，請稍候。',409,true);
    pending.set(id,true);
    const claim={processing:true,messageHash:entry.hash,conversationId:id,leaseUntil:Date.now()+(config.requestTimeoutMs??config.timeoutMs??60000)+30000};
    const options={owner,ttlMs:config.dataRetentionMs};
    let reservation;
    try{
      const row=input.conversationId?await get(id,owner):null;
      signal?.throwIfAborted();
      reservation=await store.put('conversation_requests',key,claim,{...options,expectedRevision:previous?.revision??0});
      const state=row?.value??{id,messages:[],tasks:[],updatedAt:new Date().toISOString()};
      const last=state.tasks.find(t=>t.data.serviceType!=='unknown');
      const continuation=/^(那|這|請問需要|需要哪些|要哪些|還要|然後|為什麼|how|what about)/i.test(input.message);
      const query=continuation&&last?`${last.data.summary} ${input.message}`:input.message;
      const evidence=searchVerifiedKnowledge(query);
      const context={tasks:state.tasks.map(({input:_,...task})=>task)};
      const sources=evidence.results.map(e=>({id:e.source.id,content:e.excerpts.join('\n')}));
      const answerContext={answer:sources.map(s=>s.content).join('\n'),sourceIds:sources.map(s=>s.id),sources};
      let understanding=null,answer=INSUFFICIENT_ANSWER,errorCode=null,failure,mode='retrieval';
      const correctionRequired=Boolean(state.tasks.length&&/其實|不是|改成|更正|修正|actually|instead/i.test(input.message));
      if(correctionRequired)answer='請先選擇要修正的旅程，再使用「需求不對？修正」。原有獨立任務會保留，不會自動改動準備度。';
      else if(evidence.clarification?.blocking)answer=evidence.clarification.question;
      else if(evidence.status==='out_of_scope')answer='NAVI 無法保證一定核賠。可以協助查詢流程與準備資料，但不提供投保建議或判斷能否理賠；請由專員確認。';
      else try {
        if(!provider.converse)throw new ApiError('AI_UNAVAILABLE','對話模型目前無法使用。',503,true);
        const raw=await requestValidatedAI(s=>provider.converse(input.message,context,sources,s),{config,signal});
        const parsed=ConversationGenerationSchema.parse(raw);
        understanding=await understandTasks(input.message,{config,signal,provider:{...provider,understandTasks:async()=>({tasks:parsed.tasks})}});
        const grounded=validateGroundedAnswer(parsed.answer,answerContext);
        answer=grounded.supported?grounded.answer:understanding.tasks.some(t=>t.outcome==='clarification')?'可以再說明你想處理的事情嗎？例如地址變更、查詢表單或醫療理賠資料準備。':'請選擇要處理的需求；服務條件仍需依來源與實際情況確認。';mode='live';
      }catch(error){if(signal?.aborted)throw error;understanding=null;failure=conversationFailure(error);errorCode=failure.code;answer=answerContext.answer||'目前 AI 暫時無法回應。你仍可查詢服務資料，或補充希望辦理的事項。';}
      signal?.throwIfAborted();
      return await store.transaction(async()=>{
        await sessions.session(req);
        signal?.throwIfAborted();
        let saved=understanding;
        if(saved){
          if(config.tasks)saved=await config.tasks.save(req,saved);
          for(const t of saved.tasks)await sessions.remember(req,t.input,t.data,t.id);
        }
        // MongoDB can retry the transaction callback. Build state from the original snapshot each time.
        const at=new Date().toISOString();
        const note=saved?.tasks.map(t=>t.data.summary).join('；')??(evidence.status==='answered'?'使用者查詢服務資訊。':'使用者希望補充服務需求。');
        const next={...state,tasks:saved?mergeTasks(state.tasks,saved.tasks):state.tasks,updatedAt:at,
          messages:[...state.messages,{role:'user',text:redactIdentifiers(note),at},{role:'assistant',text:answer,at}].slice(-60)};
        const reply=ConversationReplySchema.parse({...(failure?{failure}:{}),...(evidence.clarification?{clarification:evidence.clarification}:{}),correctionRequired,conversationId:id,messages:next.messages,understanding:saved,answer,evidence,mode,errorCode,knowledgeVersion:getKnowledgeVersion().knowledgeVersion});
        await store.put('conversations',id,next,{...options,expectedRevision:row?.revision??0});
        await store.put('conversation_requests',key,{reply,messageHash:entry.hash,conversationId:id},{...options,expectedRevision:reservation});
        return reply;
      });
    }catch(error){
      if(reservation!==undefined){
        // CAS never clears a newer claim or an already committed response after an ambiguous commit.
        await store.put('conversation_requests',key,{...claim,leaseUntil:0},{...options,expectedRevision:reservation}).catch(()=>{});
      }
      throw error;
    }finally{pending.delete(id);}
  }
  return {get,list,send};
}
import { createHash } from 'node:crypto';
const idempotencyConflict=()=>new ApiError('IDEMPOTENCY_CONFLICT','相同操作編號的內容不一致。',409,false);
const hashMessage=s=>createHash('sha256').update(s).digest('hex');
function mergeTasks(previous,current){return [...previous.filter(t=>!current.some(c=>c.persistedTaskId&&c.persistedTaskId===t.persistedTaskId)),...current].slice(-12);}

// Only stable public codes/messages cross the provider boundary; never raw transport errors.
export function conversationFailure(error) {
 const retryable = new Set(['AI_PROVIDER_ERROR','AI_TIMEOUT','AI_BUSY','AI_UNAVAILABLE','AI_USAGE_UNAVAILABLE','AI_RATE_LIMITED','AI_SESSION_RATE_LIMITED','TEST_SESSION_CAPACITY','STORAGE_UNAVAILABLE']);
 const known = new Set([...retryable,'AI_DAILY_LIMIT_REACHED','AI_SESSION_LIMIT_REACHED','AI_REQUEST_BUDGET_REACHED','AI_RESPONSE_INVALID','AI_SAFETY_REJECTION','AI_MODEL_UNAVAILABLE','AI_PROJECT_QUOTA_REACHED','AI_COST_LIMIT_REACHED','AI_NOT_CONFIGURED','DATA_CONSENT_REQUIRED','TEST_SESSION_REQUIRED','TEST_SESSION_DENIED','DATA_INTEGRITY_ERROR','FREE_TIER_NOT_CONFIRMED','PAID_AI_DISABLED','LIVE_AI_DISABLED_IN_CI']);
 const code=known.has(error?.code)?error.code:'AI_RESPONSE_INVALID';
 const message=code.startsWith('TEST_SESSION_')?'請重新啟用核准的合成測試工作階段；目前沒有執行 AI 分析。':code==='DATA_CONSENT_REQUIRED'?'請先確認合成資料與第三方處理說明，再繼續操作。':code==='AI_DAILY_LIMIT_REACHED'||code==='AI_SESSION_LIMIT_REACHED'||code==='AI_REQUEST_BUDGET_REACHED'?'目前 AI 使用量已達設定上限；仍可查詢有來源的資料，請稍後再試。':code==='AI_TIMEOUT'?'AI 分析逾時；尚未確認新的需求，可稍後手動重試或查詢來源。':'目前 AI 暫時無法回應；可查詢有來源的資料，或稍後手動重試。';
 return {code,message,retryable:retryable.has(code)};
}
