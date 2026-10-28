import {getKnowledgeVersion} from './services/knowledgeVersionService.js';
import { MongoStore } from './storage/mongoStore.js';
import { loadConfig } from './config/env.js';
import { createApp } from './app.js';

if (process.argv.includes('--demo')) process.env.AI_MODE = 'demo';
if (process.argv.includes('--live')) process.env.AI_MODE = 'live';
process.umask(0o077);
const config = loadConfig();
if (config.aiMode === 'live') console.info(`LIVE GEMINI REQUEST\nRequests planned: 0 at startup; manual API actions only\nMax allowed (including retries): ${config.dailyLimit} per Pacific day; ${config.productMode ? 'persistent authenticated/anonymous synthetic sessions; queued model routing' : config.publicSynthetic ? 'anonymous synthetic sessions' : 'synthetic operator session required when restricted'}`);
if(config.productMode)config.store=await new MongoStore({uri:config.mongoUri,database:config.mongoDatabase,key:config.dataEncryptionKey,production:config.production}).connect();
if(config.productMode){const knowledge=getKnowledgeVersion();await config.store.put('knowledge_releases',knowledge.knowledgeVersion,{...knowledge,observedAt:new Date().toISOString()},{ttlMs:365*86400000});await config.store.audit({operation:'startup',status:'ready',knowledgeVersion:knowledge.knowledgeVersion});}
const app = createApp(config);
const server = app.listen(config.port, config.host, () => console.info(`NAVI API listening on http://${config.host}:${config.port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(async () => { await app.locals.close?.(); process.exit(0); }); setTimeout(() => process.exit(1), 5000).unref(); });
