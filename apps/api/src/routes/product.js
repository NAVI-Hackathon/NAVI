import express from 'express';
import {z} from 'zod';
import {createHash,timingSafeEqual} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {CredentialsSchema,ConversationRequestSchema,WorkflowProgressSchema,TaskJourneyRequestSchema,HandoffDraftRequestSchema,EmailRequestSchema,ResetPasswordRequestSchema,VerifyEmailRequestSchema} from '../../../../shared/product.js';
import {createAccountEmailService} from '../services/accountEmailService.js';
import {createConversationService} from '../services/conversationService.js';
import {serviceWorkflow} from '../services/serviceWorkflows.js';
import {getKnowledgeVersion} from '../services/knowledgeVersionService.js';
import {redactIdentifiers} from '../utils/privacy.js';
import {ApiError} from '../middleware/errorHandler.js';
const hash=s=>createHash('sha256').update(s).digest();
const validate=(schema,body)=>{const p=schema.safeParse(body);if(!p.success)throw new ApiError('VALIDATION_ERROR','請確認輸入資料格式。密碼至少 12 個字元。',400,false);return p.data;};
export function createProductRouter({config,provider,sessions,repository,service}){
 const emailService=createAccountEmailService(config,config.sendMail);
 const router=express.Router(),store=config.store,conversations=createConversationService({config,provider,store});
 const authenticated=async(req,res,next)=>{try{await sessions.ensure(req,res);if(config.authRequired)await sessions.requireAccount(req);sessions.run(req,next);}catch(e){next(e);}};
 const account=async(req,res,next)=>{try{await sessions.requireAccount(req);sessions.run(req,next);}catch(e){next(e);}};
 const admin=(req,res,next)=>{const token=req.headers.authorization?.replace(/^Bearer /,'')??'';if(config.adminToken.length<32||!timingSafeEqual(hash(token),hash(config.adminToken)))return next(new ApiError('ADMIN_REQUIRED','此操作需要管理員授權。',403,false));next();};
 router.get('/ready',async(req,res)=>{await store.health();res.json({status:'ready',storage:'mongodb_encrypted',knowledgeVersion:getKnowledgeVersion().knowledgeVersion});});
 router.get('/session',async(req,res)=>res.json(await sessions.info(req,res)));
 router.post('/session/consent',async(req,res)=>res.json(await sessions.consent(req,res)));
 for(const path of ['/session/logout','/auth/logout'])router.post(path,async(req,res)=>res.json(await sessions.logout(req,res)));
 const loginLimit=rateLimit({windowMs:900000,limit:8,legacyHeaders:false,handler:(req,res)=>res.status(429).json({success:false,error:{code:'RATE_LIMITED',message:'登入操作較頻繁，請稍後再試。',retryable:true}})});
 for(const op of ['register','login'])router.post('/auth/'+op,loginLimit,async(req,res)=>{const input=validate(CredentialsSchema,req.body);if(op==='register'){const operator=(await sessions.session(req).catch(()=>null))?.operator===true;if(config.production&&!emailService.available&&!operator)throw new ApiError('ACCOUNT_REGISTRATION_UNAVAILABLE','公開帳號註冊尚未開放；測試帳號可登入，既有工作階段可繼續使用。',503,false);if((config.authRequired||config.production)&&!(operator&&!input.email)){if(!input.email)throw new ApiError('VALIDATION_ERROR','請使用電子郵件建立可驗證及恢復的帳號。',400,false);emailService.requireMail();}}const result=await sessions[op](req,res,input);if(op==='register'&&input.email&&emailService.available)await emailService.requestVerification(input.email);res.status(op==='register'?201:200).json(result);});
 router.post('/auth/verification/request',loginLimit,async(req,res)=>res.json(await emailService.requestVerification(validate(EmailRequestSchema,req.body).email)));
 router.post('/auth/verify-email',loginLimit,async(req,res)=>res.json(await emailService.verify(validate(VerifyEmailRequestSchema,req.body).token)));
 router.post('/auth/password/forgot',loginLimit,async(req,res)=>res.json(await emailService.requestReset(validate(EmailRequestSchema,req.body).email)));
 router.post('/auth/password/reset',loginLimit,async(req,res)=>{const input=validate(ResetPasswordRequestSchema,req.body);res.json(await emailService.reset(input.token,input.password));});
 router.get('/auth/me',account,async(req,res)=>{const s=await sessions.requireAccount(req),u=(await store.get('accounts',s.accountId)).value;res.json({authenticated:true,user:{id:s.owner,emailVerified:Boolean(u.emailVerified),email:u.email??null}});});
 router.get('/history',authenticated,async(req,res)=>res.json({journeys:(await sessions.owned(req)).map(j=>({id:j.id,title:j.title,serviceType:j.serviceType,workflowId:j.workflowId??null,readiness:j.readiness,updatedAt:j.updatedAt})),conversations:await conversations.list(await sessions.owner(req))}));
 router.get('/journeys',account,async(req,res)=>{
  const input=validate(z.object({limit:z.coerce.number().int().min(1).max(50).default(20),cursor:z.string().max(500).optional()}).strict(),req.query),owner=await sessions.owner(req);let cursor;
  if(input.cursor){try{cursor=JSON.parse(Buffer.from(input.cursor,'base64url'));validate(z.object({updatedAt:z.iso.datetime(),id:z.string().uuid()}).strict(),cursor);}catch{throw new ApiError('VALIDATION_ERROR','分頁位置無效。',400,false);}}
  const rows=await store.safe(()=>store.collection('journeys').find({ownerId:owner,expiresAt:{$gt:new Date()},...(cursor?{$or:[{updatedAt:{$lt:cursor.updatedAt}},{updatedAt:cursor.updatedAt,_id:{$lt:cursor.id}}]}:{})}).sort({updatedAt:-1,_id:-1}).limit(input.limit+1).toArray());
  const hasMore=rows.length>input.limit,items=[];for(const row of rows.slice(0,input.limit)){const j=store.decrypt('journeys',row);items.push({id:j.id,serviceType:j.serviceType,title:j.title,currentStage:j.currentStage,readiness:j.readiness,updatedAt:j.updatedAt,createdAt:j.createdAt,version:row.revision,hasHandoffDraft:Boolean(await store.get('handoff_drafts',j.id))});}
  const last=items.at(-1);res.json({items,nextCursor:hasMore?Buffer.from(JSON.stringify({updatedAt:last.updatedAt,id:last.id})).toString('base64url'):null});
 });
 router.get('/sessions/current/tasks',account,async(req,res)=>res.json(await config.tasks.list(req)));
 router.get('/tasks',account,async(req,res)=>res.json(await config.tasks.list(req,true)));
 router.post('/journeys',async(req,res,next)=>{if(!req.body?.taskId)return next();res.status(201).json(await sessions.run(req,()=>config.tasks.create(req,validate(TaskJourneyRequestSchema,req.body))));});
 router.get('/account/export',authenticated,async(req,res)=>res.set('Content-Disposition','attachment; filename="navi-data.json"').json(await sessions.export(req)));
 router.delete('/account/data',authenticated,async(req,res)=>{validate(z.object({confirmed:z.literal(true)}).strict(),req.body);res.json(await sessions.erase(req,res));});
 router.get('/conversations/:id',authenticated,async(req,res)=>res.json((await conversations.get(req.params.id,await sessions.owner(req))).value));
 router.post('/conversations/messages',authenticated,async(req,res)=>{const input=validate(ConversationRequestSchema,req.body),controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});const owner=await sessions.owner(req);res.json(await sessions.run(req,()=>conversations.send(input,owner,sessions,req,controller.signal)));});
 router.get('/service-workflows/:id',(req,res)=>{const f=serviceWorkflow(req.params.id);if(!f)throw new ApiError('SERVICE_NOT_SUPPORTED','目前來源沒有這項服務的可靠說明。',404,false);res.json(f);});
 router.post('/journeys/:id/checklist',async(req,res)=>res.json(await service.updateWorkflow(req.params.id,validate(WorkflowProgressSchema,req.body))));
 router.delete('/journeys/:id',async(req,res)=>{await sessions.authorize(req,req.params.id);res.json(await repository.deleteOwned(req.params.id,await sessions.owner(req)));});
 router.get('/journeys/:id/handoff/draft',account,async(req,res)=>{const row=await store.get('handoff_drafts',req.params.id),owner=await sessions.owner(req);if(!row||row.owner!==owner)return res.json({draft:null});const j=await service.get(req.params.id);res.json({draft:{...row.value,version:row.revision,stale:row.value.journeyVersion!==j.revision}});});
 router.put('/journeys/:id/handoff/draft',account,async(req,res)=>{const input=validate(HandoffDraftRequestSchema,req.body),owner=await sessions.owner(req);res.json(await store.transaction(async()=>{await sessions.authorize(req,req.params.id);const j=await service.get(req.params.id);if(j.revision!==input.journeyVersion)throw new ApiError('JOURNEY_STALE','需求或文件已更新，請重新預覽。',409,false);const value={journeyId:j.id,text:redactIdentifiers(input.text),journeyVersion:j.revision,updatedAt:new Date().toISOString(),delivery:'not_sent'};const version=await store.put('handoff_drafts',j.id,value,{owner,journeyId:j.id,expectedRevision:input.version,ttlMs:config.dataRetentionMs});return {draft:{...value,version,stale:false}};}));});
 router.delete('/journeys/:id/handoff/draft',account,async(req,res)=>{await store.delete('handoff_drafts',req.params.id);res.json({deleted:true});});
 router.get('/journeys/:id/handoff/download',async(req,res)=>{const saved=(await store.list('handoff_confirmed',await sessions.owner(req))).filter(r=>r.value.journeyId===req.params.id).sort((a,b)=>a.value.confirmedAt.localeCompare(b.value.confirmedAt)).at(-1)?.value;if(!saved)throw new ApiError('HANDOFF_CONFIRMATION_REQUIRED','請先預覽並確認摘要。',409,false);if(saved.journeyVersion!==(await service.get(req.params.id)).revision)throw new ApiError('HANDOFF_PREVIEW_STALE','資料已更新，請重新預覽並確認後下載摘要。',409,false);const s=saved.summary;res.set({'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="navi-handoff.txt"'}).send([s.issue,'已收集：'+s.collected.join('、'),'待補充：'+s.missing.join('、'),'待確認：'+s.concerns.join('、'),s.reason,s.disclaimer,'官方客服專線：0800-012-899',...s.sources.filter(x=>x.url).map(x=>`${x.title} ${x.url}（擷取 ${x.retrievedAt}）`)].join('\n'));});
 router.get('/ops/status',admin,async(req,res)=>res.json({storage:await store.health(),modelHealth:provider.getModelRouter?.()?.getModelHealth()??{},usage:await provider.getModelRouter?.()?.getUsageMetrics()??{},knowledge:getKnowledgeVersion(),events:(await store.list('audit')).slice(-100).map(r=>r.value)}));
 router.post('/ops/backup',admin,async(req,res)=>res.json(await store.backup(config.databasePath+'/backups')));
 return router;
}
