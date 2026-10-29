import test from 'node:test';
import assert from 'node:assert/strict';
import { searchKnowledge, verifyEvidenceSnippet, verifyNavigationDestination } from '../../../shared/knowledge/index.js';
import { searchVerifiedKnowledge } from '../../../shared/knowledge/evidence.js';
import { isDecisionQuestion } from '../../../shared/knowledge/vocabulary.js';
import { planNavigation } from '../../../shared/knowledge/navigationPlan.js';
import { normalizeIntent } from '../src/schemas/intent.schema.js';
import { answerKnowledge } from '../src/services/knowledgeAnswerService.js';
import { conversationFailure } from '../src/services/conversationService.js';

const payment = ['我要變更保費付款方式。','更換保費扣款方式','想把繳費改成轉帳','保費要用信用卡付款','payment method change','保費繳納方式如何更改','我想換扣繳的信用卡','缴费方式變更','不要改紅利，只改保費扣款'];
const dividend = ['我要變更紅利給付方式','紅利領取要怎麼改','我想修改分紅方式','dividend option change','紅利抵繳保費怎麼選','不要改保費，只改紅利領取方式','紅利給付可改轉帳嗎','dividend payment change'];
for (const [queries,id,anchor] of [[payment,'service:change_payment_method','service-change-payment-method'],[dividend,'service:change_dividend_option','service-change-dividend-option']]) for (const query of queries) test('subject before ranking and navigation: '+query,()=>{
 const result=searchKnowledge(query);assert.equal(result.status,'answered');assert.equal(result.results[0].id,id);assert.equal(result.results[0].destination.anchor,anchor);
 const evidence=searchVerifiedKnowledge(query);assert.equal(evidence.results[0].source.id,id);assert.ok(evidence.results.every(r=>r.excerpts.every(x=>verifyEvidenceSnippet(r.source.id,x))));
 const plan=planNavigation({query});assert.equal(plan.plan.rootSourceId,id);assert.ok(plan.plan.steps.every(s=>verifyNavigationDestination(s.destination,s.sourceId)));
 const wrong=id.includes('payment')?'service:change_dividend_option':'service:change_payment_method';assert.ok(!result.results.some(r=>r.id===wrong));
});
for(const query of ['我不知道要辦什麼。','不清楚要辦哪個，幫我處理一下','我不確定要辦哪個事情','I don\'t know what to do','我要申請理賠，可是忘記日期。','我要理賠但忘了哪天','理賠的日期我不記得了','申請理賠，但不知道是哪一天','我要申請理賠'])test('ambiguous input does not select an incident or route: '+query,()=>{
 const r=searchKnowledge(query);assert.equal(r.status,'not_found');assert.deepEqual(r.results,[]);assert.equal(r.clarification.blocking,true);assert.ok(r.clarification.options.length);assert.equal(planNavigation({query}).plan,null);
 const unsafe={intent:'service_request',serviceType:'hospitalization_claim',confidence:.99,summary:'MODEL INVENTED',extractedData:{origin:null,destination:null,delayMinutes:null,incidentDate:'2026-10-01',hospitalName:'MODEL INVENTED'}};
 const normalized=normalizeIntent(unsafe,query);assert.equal(normalized.serviceType,'unknown');assert.equal(normalized.extractedData.incidentDate,null);assert.equal(normalized.extractedData.hospitalName,undefined);
});
for(const query of ['幫我保證一定可以理賠。','保證住院一定核賠','請承諾一定給付','我一定可以理賠嗎'])test('explicit refusal of insurance guarantees: '+query,()=>{const r=searchVerifiedKnowledge(query);assert.equal(r.status,'out_of_scope');assert.match(r.clarification.question,/無法保證/);assert.deepEqual(r.results,[]);});
for(const [query,id] of [['我住院五天應備文件','claim-doc:2'],['門診理賠需要哪些文件','claim-doc:1'],['保單借款怎麼辦','service:policy_loan'],['下載契約內容變更申請書','form:form_contract_change'],['身分證發證日期如何填寫','faq:7']])test('specific queries remain usable: '+query,()=>{const r=searchKnowledge(query);assert.equal(r.status,'answered');if(query.startsWith('身分證'))assert.ok(r.results.some(x=>/身分證/.test(x.content)));else assert.equal(r.results[0].id,id);});
test('mixed payment and dividend asks which task, not a guessed navigation',()=>{const r=searchKnowledge('我要改保費繳費方式，也想修改紅利給付方式');assert.equal(r.status,'not_found');assert.equal(r.clarification.reason,'payment_or_dividend');});
test('address and beneficiary subtype questions preserve known source without eligibility claims',()=>{
 for(const [query,reason]of[['我要改地址','address_type_missing'],['我要變更受益人','beneficiary_type_missing']]){const r=searchVerifiedKnowledge(query);assert.equal(r.status,'answered');assert.equal(r.clarification.reason,reason);assert.equal(r.clarification.blocking,false);}
 for(const query of ['我要改通訊地址','我要改戶籍地址','我要改收費地址'])assert.notEqual(searchKnowledge(query).clarification?.reason,'address_type_missing');
 assert.equal(planNavigation({sourceId:'form:form_contract_change'}).plan.steps.length,1);const steps=planNavigation({sourceId:'service:change_address'}).plan.steps;assert.equal(steps.length,2);assert.equal(new Set(steps.map(s=>s.destination.path+'#'+s.destination.anchor)).size,2);
});
test('provider failures expose stable actionable codes without raw transport details',()=>{
 for(const code of ['AI_PROVIDER_ERROR','AI_TIMEOUT','AI_BUSY','AI_DAILY_LIMIT_REACHED','AI_USAGE_UNAVAILABLE','STORAGE_UNAVAILABLE']){const f=conversationFailure({code,message:'secret mongodb://PRIVATE Cookie=PRIVATE'});assert.equal(f.code,code);assert.equal(f.retryable,!['AI_DAILY_LIMIT_REACHED'].includes(code));assert.doesNotMatch(JSON.stringify(f),/PRIVATE|mongodb|Cookie/);}
 assert.equal(conversationFailure({code:'SECRET_UNTRUSTED_MESSAGE'}).code,'AI_RESPONSE_INVALID');
});

test('knowledge answer endpoint services refuse guarantees and clarify without AI generation',async()=>{
 let calls=0;for(const question of ['幫我保證一定可以理賠。','我不知道要辦什麼。','我要申請理賠，可是忘記日期。']){const r=await answerKnowledge(question,{provider:{answerKnowledge:()=>{calls++;}},config:{}});assert.equal(r.supported,false);assert.ok(r.clarification.blocking);assert.equal(r.answer,r.clarification.question);}assert.equal(calls,0);
});

test('generic benefit-method changes do not guess payment or dividend',()=>{const r=searchKnowledge('我要變更給付方式');assert.equal(r.status,'not_found');assert.equal(r.clarification.reason,'payment_or_dividend');});

test('normal claim document requirements are not classified as demands for guaranteed payout',()=>{for(const q of ['理賠一定要正本嗎','理賠一定要準備哪些文件'])assert.equal(searchKnowledge(q).status,'answered');});

test('negating a request for a payout decision does not erase a separate positive request',()=>{for(const q of ['不要保證一定核賠，我只想看申請流程','不用你判斷是否給付，請提供應備文件','我沒有要你幫我推算金額，只問理賠說明'])assert.equal(isDecisionQuestion(q),false,q);assert.equal(isDecisionQuestion('不要判斷資格，請保證一定理賠'),true);});
