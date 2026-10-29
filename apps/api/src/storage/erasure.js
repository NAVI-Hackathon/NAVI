import {createHmac,hkdfSync,timingSafeEqual} from 'node:crypto';
import {ApiError} from '../middleware/errorHandler.js';
export const BACKUP_RETENTION_MS=7*86400000;
export const ERASURE_RETENTION_MS=8*86400000;
export const erasureTag=(key,value)=>createHmac('sha256',hkdfSync('sha256',key,Buffer.alloc(0),'NAVI erasure v1',32)).update(JSON.stringify(value)).digest('hex');
export const recordTag=(key,namespace,row)=>erasureTag(key,['record',namespace,row._id,row.ownerId]);
export function sealErasurePlan(key,payload){return {payload,signature:erasureTag(key,payload)};}
// shortcut: recovery requires a fresh source ledger and paused writers; replicate an independent deletion journal before claiming disaster recovery.
export function verifyErasurePlan(key,plan,now,createdAt){
 const invalid=()=>{throw new ApiError('RESTORE_ERASURE_PLAN_REQUIRED','還原需要暫停寫入後匯出的最新刪除紀錄與用量；未還原任何資料。',503,false);};
 if(!plan?.payload||!/^[a-f0-9]{64}$/.test(plan.signature??''))invalid();
 if(!timingSafeEqual(Buffer.from(plan.signature,'hex'),Buffer.from(erasureTag(key,plan.payload),'hex')))invalid();
 const p=plan.payload,asOf=Date.parse(p.asOf),backupAt=Date.parse(createdAt);
 if(p.kind!=='navi-erasure-plan'||p.version!==1||!/^navi(?:_|$)/.test(p.database)||!Array.isArray(p.records)||!Array.isArray(p.budgets)||!Number.isFinite(Date.parse(p.coverageSince))||Date.parse(p.coverageSince)>backupAt||!Number.isFinite(asOf)||!Number.isFinite(backupAt)||asOf>now||now-asOf>300000||asOf<backupAt||now-backupAt>BACKUP_RETENTION_MS)invalid();
 return p;
}
