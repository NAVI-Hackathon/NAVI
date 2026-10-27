import {loadConfig} from '../config/env.js';
import {MongoStore} from './mongoStore.js';
const config=loadConfig(),action=process.argv[2];
if(!config.productMode)throw Error('Product persistence is not configured');
const store=await new MongoStore({uri:config.mongoUri,database:config.mongoDatabase,key:config.dataEncryptionKey,production:config.production}).connect();
try{
 if(action==='backup')console.info(JSON.stringify(await store.backup(config.databasePath+'/backups')));
 else if(action==='restore'){
  if(process.argv[4]!=='--confirm'||!/_restore_[a-zA-Z0-9]+$/.test(config.mongoDatabase))throw Error('Restore requires a separate empty NAVI _restore_<suffix> database and --confirm');
  await store.restore(process.argv[3]);console.info('Encrypted NAVI backup restored to the isolated target database.');
 }else throw Error('Use backup or restore <backup.jsonl> --confirm');
}finally{await store.close();}
