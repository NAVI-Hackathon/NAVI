// Deterministic synthetic Renderer fixtures, never results from Google Gemini.
import {ConversationReplySchema} from '../../shared/product.js';
import {searchVerifiedKnowledge} from '../../shared/knowledge/evidence.js';
import {cardif} from '../../shared/cardif.js';
const evidence=searchVerifiedKnowledge('我要改通訊地址');
const base={conversationId:'a0000000-0000-4000-8000-000000000001',messages:[],understanding:null,answer:evidence.results[0].excerpts.join('\n'),evidence,mode:'retrieval',errorCode:null,knowledgeVersion:cardif.meta.knowledgeVersion};
const reply=value=>ConversationReplySchema.parse({...base,...value});
export const judgeConversationFixtures={
 retrievalOnly:reply({errorCode:'AI_PROVIDER_ERROR',failure:{code:'AI_PROVIDER_ERROR',message:'AI 暫時無法回應；以下為來源資料。',retryable:true}}),
 timeout:reply({errorCode:'AI_TIMEOUT',failure:{code:'AI_TIMEOUT',message:'AI 分析逾時，請稍後手動重試。',retryable:true}}),
 quota:reply({errorCode:'AI_DAILY_LIMIT_REACHED',failure:{code:'AI_DAILY_LIMIT_REACHED',message:'目前使用量已達設定上限。',retryable:false}}),
 noResults:reply({answer:'目前提供的資料不足以確認。',evidence:searchVerifiedKnowledge('土星導航演唱會')}),
 clarification:(()=>{const e=searchVerifiedKnowledge('我不知道要辦什麼。');return reply({answer:e.clarification.question,evidence:e,clarification:e.clarification});})(),
 insuranceBoundary:(()=>{const e=searchVerifiedKnowledge('幫我保證一定可以理賠。');return reply({answer:e.clarification.question,evidence:e,clarification:e.clarification});})(),
 aiSuccess:reply({mode:'live',understanding:{tasks:[{id:'task-1',input:'我要改通訊地址',data:{intent:'service_request',serviceType:'policy_change',summary:'使用者希望了解保單資料變更的辦理方式。',confidence:.9,extractedData:{origin:null,destination:null,delayMinutes:null,incidentDate:null}},outcome:'preview'}],nextStep:'confirm_one_task',provider:'live',isMock:false,disclaimer:'測試替身回覆，不是 Google 模型品質證據。'}}),
};
