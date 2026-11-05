import {readFile,writeFile,lstat} from 'node:fs/promises';
import {importLegacyUsage} from './importUsage.js';
import {loadConfig} from '../config/env.js';
import {MongoStore} from './mongoStore.js';
const config=loadConfig(),action=process.argv[2];
if(!config.productMode)throw Error('Product persistence is not configured');
const store=await new MongoStore({uri:config.mongoUri,database:config.mongoDatabase,key:config.dataEncryptionKey,production:config.production}).connect();
try{
 if(action==='import-usage')console.info(JSON.stringify(await importLegacyUsage(store,config.usageFile,config.modelPolicies)));
 else if(action==='backup')console.info(JSON.stringify(await store.backup(config.databasePath+'/backups')));
 else if(action==='erasure-plan'){
  if(!process.argv[3]||process.argv[4]!=='--source-paused')throw Error('Pause source writers and acknowledge --source-paused before exporting; keep them paused through restore');
  await writeFile(process.argv[3],JSON.stringify(await store.exportErasurePlan())+'\n',{flag:'wx',mode:0o600});console.info('Private erasure plan exported; do not publish it. Keep source writes paused.');
 }else if(action==='restore'){
  if(process.argv[4]!=='--confirm'||!/_restore_[a-zA-Z0-9]+$/.test(config.mongoDatabase))throw Error('Restore requires a separate empty NAVI _restore_<suffix> database and --confirm');
  const path=process.argv[5];if(!path)throw Error('Provide the latest private erasure plan after --confirm');const stat=await lstat(path);if(stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.mode&0o077)throw Error('Unsafe erasure plan');
  await store.restore(process.argv[3],{erasurePlan:JSON.parse(await readFile(path,'utf8'))});console.info('Encrypted NAVI backup restored to the isolated target database.');
 }else throw Error('Use import-usage, backup, erasure-plan <private.json>, or restore <backup.jsonl> --confirm <private-erasure-plan.json>');
}finally{await store.close();}
