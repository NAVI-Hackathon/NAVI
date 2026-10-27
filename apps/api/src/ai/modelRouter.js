import { setTimeout as delay } from 'node:timers/promises';
import { createResourceQueue } from './resourceQueue.js';
import { assertLiveAllowed } from './costGuard.js';
import { ApiError } from '../middleware/errorHandler.js';

async function bounded(signal,operation){signal.throwIfAborted();let abort;const interrupted=new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});});try{return await Promise.race([Promise.resolve().then(operation),interrupted]);}finally{signal.removeEventListener('abort',abort);}}
const endpoint = 'https://generativelanguage.googleapis.com/v1beta/';
const pacificDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function createModelRouter(config, fetchImpl, { store = config.store, quota, budget, now = Date.now } = {}) {
  const queue = createResourceQueue({ concurrency: config.maxConcurrent, capacity: Math.max(2, config.maxConcurrent + 1), limit: config.queueLimit, waitMs: config.queueWaitMs, rpm: config.requestsPerMinute });
  const health = new Map(); let inventory = null, inventoryUntil = 0, discovering; const metadata = new Map();
  let healthLoaded=false;
  async function discoverModels(signal) {
    if (inventory && inventoryUntil > now()) return inventory;
    if (!discovering) discovering = (async () => {
      const found = []; let pageToken;
      for (let page = 0; page < 10; page++) {
        const url = new URL(endpoint + 'models'); url.searchParams.set('pageSize','100'); if (pageToken) url.searchParams.set('pageToken',pageToken);
        const res = await bounded(signal,()=>fetchImpl(url.toString(), { headers: { 'x-goog-api-key': config.apiKey }, signal }));
        if (!res.ok) throw new ApiError('AI_UNAVAILABLE', '目前無法確認可用模型，請稍後再試。', 503, true);
        const body = await res.json(); if (!Array.isArray(body.models)) throw new ApiError('AI_RESPONSE_INVALID','模型目錄回應不完整。',503,false);
        found.push(...body.models.filter(m => typeof m.name === 'string' && m.supportedGenerationMethods?.includes('generateContent')).map(m => m.name.replace(/^models\//,'')));
        pageToken = body.nextPageToken; if (!pageToken) { inventory = [...new Set(found)]; inventoryUntil = now()+300000; return inventory; }
      }
      throw new ApiError('AI_UNAVAILABLE','模型目錄尚未完整取得。',503,false);
    })().finally(() => { discovering = null; });
    return discovering;
  }
  function compatible(model, task) { return model.confirmed && model.capabilities.includes('structured') && model.capabilities.includes(task) && (model.tier === 'free' || config.allowPaidAI && config.billingConfirmed && config.paidAuthorization && config.paidBudgetCents > 0); }
  async function markModelUnhealthy(id, code, cooldown = 15000) { const value={code,until:now()+cooldown}; health.set(id,value); await store?.put('model_health',id,value,{ttlMs:cooldown}); }
  async function recoverModel(id) { health.delete(id); await store?.delete('model_health',id); }
  async function generateWithFallback({ operation, payload, validate, signal }) {
    const task = payload.contents[0].parts.some(p => p.inlineData?.mimeType === 'application/pdf') ? 'pdf' : payload.contents[0].parts.some(p => p.inlineData) ? 'image' : 'text';
    const cancelled = signal ?? AbortSignal.timeout(config.requestTimeoutMs);
    return queue.run(async () => {
      assertLiveAllowed(config);
      if(store&&!healthLoaded){for(const row of await store.list('model_health'))if(row.value.until>now())health.set(row.id,row.value);healthLoaded=true;}
      const available = await discoverModels(cancelled);
      const candidates = config.modelPolicies.filter(m => available.includes(m.id) && compatible(m,task));
      if (!candidates.length) throw new ApiError('AI_MODEL_UNAVAILABLE', '目前沒有可處理這項資料的已核准模型，請改用資料查詢或稍後再試。',503,false);
      let previousModel, last; const tried = new Set();
      for (let attempt=1; attempt<=config.routeAttempts; attempt++) {
        cancelled.throwIfAborted();
        const selected = candidates.find(m => !tried.has(m.id) && !(health.get(m.id)?.until > now())) ?? (attempt === 2 && candidates.length === 1 && last?.code === 'AI_PROVIDER_ERROR' ? candidates[0] : null);
        if (!selected) break;
        tried.add(selected.id); let lease; const start=performance.now();
        const timeout=AbortSignal.timeout(config.timeoutMs), combined=AbortSignal.any([cancelled,timeout]);
        try {
          // Reserve every attempt, including failures and model switches; no billing/key rotation.
          await config.chargeSessionAttempt?.();
          if (store) { await store.charge(pacificDay(),'requests',config.dailyLimit); if (selected.tier==='paid') await store.charge(pacificDay(),'paid',config.paidBudgetCents,selected.maxRequestCostCents); }
          else { lease=quota?.acquire(); budget?.consume(); }
          const body={...payload, generationConfig:{...payload.generationConfig}};
          if (!selected.id.startsWith('gemini-3.')) delete body.generationConfig.thinkingConfig;
          const res=await bounded(combined,()=>fetchImpl(`${endpoint}models/${selected.id}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':config.apiKey},body:JSON.stringify(body),signal:combined}));
          const data=await res.json().catch(()=>null);
          if (!res.ok) {
            const details=JSON.stringify(data?.error?.details ?? []);
            const modelQuota=/PerModel|per_model|\bmodel\b/i.test(details);
            if (res.status===429 && !modelQuota) throw new ApiError('AI_PROJECT_QUOTA_REACHED','目前 Google 專案額度暫時不足；可繼續使用有來源的服務查詢。',429,false);
            throw new ApiError(res.status===429?'AI_RATE_LIMITED':res.status===404?'AI_MODEL_UNAVAILABLE':'AI_PROVIDER_ERROR','目前模型暫時無法回應，請稍後再試。',res.status===429?429:503,[429,404,408,500,502,503,504].includes(res.status));
          }
          const candidate=data?.candidates?.[0];
          if(data?.promptFeedback?.blockReason||['SAFETY','RECITATION','PROHIBITED_CONTENT','BLOCKLIST'].includes(candidate?.finishReason)) throw new ApiError('AI_SAFETY_REJECTION','這份資料無法可靠分析，請重新提供清晰且適用的資料。',422,false);
          if(candidate?.finishReason!=='STOP')throw new ApiError('AI_RESPONSE_INVALID','模型未提供完整結果，請稍後再試。',502,false);
          const raw=JSON.parse(candidate.content.parts.filter(p=>!p.thought).map(p=>p.text||'').join(''));
          const result=validate(raw); await recoverModel(selected.id);
          const event={operation,model:selected.id,previousModel,attempt,status:'ok',latencyMs:Math.round(performance.now()-start),tokens:data.usageMetadata?.totalTokenCount ?? null};
          metadata.set(operation,{provider:'gemini',...event,schemaValid:true,fallbackUsed:false});await store?.audit(event);return result;
        } catch(error) {
          if(cancelled.aborted)throw cancelled.reason;
          last=timeout.aborted?new ApiError('AI_TIMEOUT','AI 分析逾時；資料尚未更動，請稍後再試。',504,true):error instanceof ApiError?error:error instanceof SyntaxError||error.name==='ZodError'?new ApiError('AI_RESPONSE_INVALID','分析結果格式不完整，資料尚未更動。',502,false):new ApiError('AI_PROVIDER_ERROR','目前模型連線暫時無法使用。',503,true);
          const event={operation,model:selected.id,previousModel,attempt,code:last.code??'AI_RESPONSE_INVALID',status:'failed',latencyMs:Math.round(performance.now()-start)};
          await store?.audit(event);metadata.set(operation,{provider:'gemini',...event,schemaValid:false,fallbackUsed:false});
          if(!(last instanceof ApiError)||!last.retryable)throw last;
          await markModelUnhealthy(selected.id,last.code,last.code==='AI_MODEL_UNAVAILABLE'?300000:15000);
          previousModel=selected.id;
          if(attempt<config.routeAttempts)await delay(Math.min(100*attempt,300),undefined,{signal:cancelled});
        } finally { if(lease)quota.release(lease); }
      }
      throw last ?? new ApiError('AI_UNAVAILABLE','目前模型正在恢復中；你仍可查詢服務資訊與整理資料。',503,true);
    },{signal:cancelled,weight:task==='text'?1:2});
  }
  return { discoverModels,generateWithFallback,markModelUnhealthy,recoverModel,getModelHealth:()=>Object.fromEntries(health),getUsageMetrics:async()=>({...queue.status(),daily:store?{day:pacificDay(),used:(await store.usage(pacificDay()))?.used??0,limit:config.dailyLimit}:null,requestsPerMinute:config.requestsPerMinute,maxConcurrent:config.maxConcurrent,sessionLifetimeLimit:config.sessionRequestLimit,sessionRequestsPerMinute:config.sessionRateLimit,routeAttempts:config.routeAttempts,attemptTimeoutMs:config.timeoutMs,requestTimeoutMs:config.requestTimeoutMs,paidEnabled:config.allowPaidAI}),getDebugMetadata:()=>Object.fromEntries(metadata) };
}
