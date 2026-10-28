import {MongoClient} from 'mongodb';
import {MongoStore} from '../src/storage/mongoStore.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {loadConfig} from '../src/config/env.js';
export const TEST_URI=process.env.MONGODB_TEST_URI??'mongodb://127.0.0.1:27139/?replicaSet=naviTest';
if(!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(TEST_URI))throw Error('Integration tests require an isolated loopback replica set, never Atlas or a production database');
export function fixture(t){const database='navi_test_'+randomUUID().replaceAll('-',''),dir=mkdtempSync(join(tmpdir(),'navi-mongo-')),f={uri:TEST_URI,database,key:randomBytes(32).toString('base64'),dir};t.after(async()=>{const c=await new MongoClient(TEST_URI).connect();try{await c.db(database).dropDatabase();}finally{await c.close();rmSync(dir,{recursive:true,force:true});}});return f;}
export async function store(f){return new MongoStore(f).connect();}
export function config(f,extra={}){return {...loadConfig({NAVI_PRODUCT_MODE:'true',MONGODB_URI:f.uri,MONGODB_DATABASE:f.database,NAVI_PRIVATE_STATE_PATH:f.dir,NAVI_DATA_ENCRYPTION_KEY:f.key,AI_MODE:'live',GEMINI_API_KEY:'mock-only',GEMINI_FREE_TIER_CONFIRMED:'true',AI_PUBLIC_SYNTHETIC:'true',AI_SYNTHETIC_TEST_ONLY:'true',WEB_ORIGINS:'https://app.navitw.com'}),requestsPerMinute:1000,rateLimit:1000,...extra};}
