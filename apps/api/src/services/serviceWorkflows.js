import { getKnowledgeEntry, searchKnowledge } from '../../../../shared/knowledge/index.js';
import { getSources } from './knowledgeService.js';
import { buildNavigationPlan } from '../../../../shared/knowledge/navigationPlan.js';
import { ApiError } from '../middleware/errorHandler.js';
import { checkEvidenceConsistency } from './evidenceConsistencyService.js';

const catalog={
  outpatient_claim:{sourceId:'claim-doc:1',title:'門診醫療理賠資料準備'},
  change_address:{sourceId:'service:change_address',title:'地址變更'},
  contract_change_form:{sourceId:'form:form_contract_change',title:'契約內容變更申請書'},
  change_payment_method:{sourceId:'service:change_payment_method',title:'繳費方式變更'},
  policy_loan:{sourceId:'service:policy_loan',title:'保單借款資料準備'},
  change_beneficiary:{sourceId:'service:change_beneficiary',title:'受益人變更'},
};
export function selectServiceWorkflow(data,message) {
  if(data.serviceType==='outpatient_claim')return 'outpatient_claim';
  const entry=searchKnowledge(message).results[0];
  return Object.entries(catalog).find(([,value])=>value.sourceId===entry?.id)?.[0]??null;
}
export function serviceWorkflow(id) {
  const item=catalog[id];if(!item)return null;const source=getKnowledgeEntry(item.sourceId);if(!source)return null;
  // Checklists quote the approved snapshot; no invented eligibility or document rules.
  return {...item,id,source,checklist:source.content.split('\n').filter(s=>s.trim()).slice(1,18),plan:buildNavigationPlan(item.sourceId)};
}
export function deriveServiceWorkflow(journey, config) {
  const flow=serviceWorkflow(journey.workflowId);if(!flow)return journey;
  const required=['source_reviewed','information_prepared','ready_for_official_service'];
  const checked=new Set(journey.checklist??[]);
  const documents=journey.workflowId==='outpatient_claim'?(journey.documents??[]):[];
  const issues=checkEvidenceConsistency(documents,journey.extractedData);
  const blocked=journey.confidence<config.confidenceThreshold||issues.length>0||documents.some(d=>d.status!=='verified'||d.requiresRevalidation);
  const requirements=required.map((id,i)=>({id,name:['已閱讀來源與條件','已準備來源列出的適用資料','已確認後續正式辦理方式'][i],description:i===0?flow.source.content:i===1?'只確認你已準備適用資料；不是文件真偽或保單資格驗證。':'NAVI 不會代為送出申請。',required:true,status:checked.has(id)?'verified':'missing',weight:[30,40,30][i]}));
  if(blocked)for(const r of requirements)if(r.id!=='source_reviewed')r.status='needs_review';
  const next=requirements.find(r=>r.status!=='verified')?.id;
  return {...journey,supported:true,sources:getSources([flow.sourceId]),documents:journey.documents??[],requirements,consistencyIssues:issues,confirmed:!next&&!blocked,currentStage:blocked?'HUMAN_REVIEW':next?'EVIDENCE_COLLECTION':'READY_TO_PROCEED',readiness:requirements.reduce((n,r)=>n+(r.status==='verified'?r.weight:0),0),nextAction:{type:blocked?'CONTACT_SPECIALIST':next?'PROVIDE_INFORMATION':'PROCEED_TO_SERVICE',target:next??null,title:blocked?'請先確認文件或需求資訊':next?requirements.find(r=>r.id===next).name:'前往正式服務說明',description:'請依來源確認適用條件；資料準備完成不代表申請已送出或資格已核准。',destination:flow.source.destination},disclaimer:'這是資料準備與服務導航；不驗證保單資格、文件真偽或申請結果。'};
}
export function updateWorkflow(journey,checked,config) {
  const allowed=['source_reviewed','information_prepared','ready_for_official_service'];
  if(checked.some(id=>!allowed.includes(id))||new Set(checked).size!==checked.length||checked.some((id,i)=>id!==allowed[i]))throw new ApiError('INVALID_INPUT','請依序確認已完成的準備步驟。',400,false);
  return deriveServiceWorkflow({...journey,checklist:checked,updatedAt:new Date().toISOString()},config);
}
