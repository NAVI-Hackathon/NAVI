import {readdir,lstat,unlink,rmdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
export function startMaintenance(store,config){
 const directory=config.databasePath;let pending=Promise.resolve();
 async function run(){
  await store.cleanup();
  const uploads=join(directory,'uploads');
  for(const name of await readdir(uploads).catch(()=>[]))if(/^doc-[A-Za-z0-9]+$/.test(name)){
   const folder=join(uploads,name),stat=await lstat(folder);
   if(stat.isSymbolicLink()||!stat.isDirectory()||stat.uid!==process.getuid()||Date.now()-stat.mtimeMs<300000)continue;
   const entries=await readdir(folder);
   if(entries.some(file=>file!=='upload.pdf'))continue;
   if(entries.length){const file=join(folder,'upload.pdf'),s=await lstat(file);if(s.isSymbolicLink()||!s.isFile()||s.uid!==process.getuid())continue;await unlink(file);}
   await rmdir(folder);
  }
  if(!await store.get('maintenance','last_backup')){
   await store.backup(join(directory,'backups'));
   await store.put('maintenance','last_backup',{at:new Date().toISOString()},{ttlMs:86400000});
  }
 }
 const tick=()=>{pending=pending.then(run).catch(async()=>{try{await store.audit({code:'MAINTENANCE_FAILED',operation:'maintenance',status:'failed'});}catch{console.warn(JSON.stringify({event:'maintenance_failed',code:'STORAGE_UNAVAILABLE'}));}});};
 const initial=setTimeout(tick,15000);initial.unref();
 const interval=setInterval(tick,3600000);interval.unref();
 return async()=>{clearTimeout(initial);clearInterval(interval);await pending;await store.close();};
}
