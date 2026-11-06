// Isolated acceptance fixture: actual Express/Mongo; no model transport or production URI.
import{readFileSync}from'node:fs';import{createServer}from'node:http';import{createApp}from'../../apps/api/src/app.js';import{loadConfig}from'../../apps/api/src/config/env.js';import{MongoStore}from'../../apps/api/src/storage/mongoStore.js';import{installShutdown}from'../../apps/api/src/utils/shutdown.js';
if(!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(process.env.MONGODB_TEST_URI??''))throw Error('Isolated Mongo only');
const raw=readFileSync(process.env.NAVI_LOCAL_ENV,'utf8');if(raw.includes('FAIL_START=true'))process.exit(1);
const c=loadConfig({AI_MODE:'live',NAVI_PRODUCT_MODE:'true',MONGODB_URI:process.env.MONGODB_TEST_URI,MONGODB_DB_NAME:process.env.NAVI_LOCAL_DB,NAVI_DATA_ENCRYPTION_KEY:process.env.NAVI_LOCAL_KEY,NAVI_PRIVATE_STATE_PATH:process.env.NAVI_LOCAL_STATE,AI_SYNTHETIC_TEST_ONLY:'true',WEB_ORIGINS:'https://app.navitw.com'});
c.store=await new MongoStore({uri:c.mongoUri,database:c.mongoDatabase,key:c.dataEncryptionKey}).connect();
if(!await c.store.get('maintenance','recovery-marker'))await c.store.put('maintenance','recovery-marker',{synthetic:true,createdAt:new Date().toISOString()});
const marker=(await c.store.get('maintenance','recovery-marker')).value;
if(raw.includes('FAIL_READY=true'))await c.store.close();
const app=createApp({...c,rateLimit:1000},{mode:'unavailable'});const server=createServer((req,res)=>{if(req.url==='/probe'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({cwd:process.cwd(),marker}));}app(req,res);});server.listen(Number(process.env.NAVI_LOCAL_PORT),'127.0.0.1');installShutdown({server,app});
