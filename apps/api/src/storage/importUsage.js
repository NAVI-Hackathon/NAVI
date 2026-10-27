import {lstat,readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
export async function importLegacyUsage(store,file,models=[]){
 if(!isAbsolute(file??''))throw Error('Use the configured private legacy usage ledger');const stat=await lstat(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.uid!==process.getuid()||stat.mode&0o077)throw Error('Unsafe usage ledger');
 const old=JSON.parse(await readFile(file,'utf8')),now=Date.now(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(old.version!==1||!/^\d{4}-\d{2}-\d{2}$/.test(old.day)||old.day>today||!Number.isSafeInteger(old.used)||old.used<0||!Number.isFinite(old.blockedUntil)||!Array.isArray(old.leases)||old.leases.some(l=>!Number.isFinite(l.until)||l.until>now))throw Error('Invalid or in-flight legacy usage; stop NAVI and wait for requests to finish');
 return store.transaction(async()=>{const id='legacy_usage:'+old.day;if(await store.get('maintenance',id))return {day:old.day,alreadyImported:true};await store.db.collection('usage_budgets').updateOne({_id:old.day+':requests'},{$inc:{used:old.used},$setOnInsert:{day:old.day,kind:'requests',expiresAt:new Date(now+90*86400000)}},{...store.options(),upsert:true});
 if(old.blockedUntil>now)for(const model of models)await store.put('model_health',model.id,{code:'LEGACY_PROVIDER_BACKOFF',until:old.blockedUntil},{ttlMs:old.blockedUntil-now});await store.put('maintenance',id,{day:old.day,imported:old.used},{ttlMs:90*86400000});return {day:old.day,imported:old.used};});
}
