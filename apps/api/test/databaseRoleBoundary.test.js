import test from 'node:test';import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';import {spawn}from'node:child_process';import {randomBytes}from'node:crypto';import {mkdtemp,mkdir,open,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import net from'node:net';
// A separate local --auth process: never create users or change roles on Atlas.
test('a real MongoDB readWrite principal can index its NAVI database and is denied other DBs and role administration',async t=>{
 assert.ok(process.env.MONGOD_BINARY,'Set MONGOD_BINARY to the same official local test runtime');
 const dir=await mkdtemp(join(tmpdir(),'navi-role-test-'));await mkdir(join(dir,'db'),{mode:0o700});const log=await open(join(dir,'mongo.log'),'wx',0o600),probe=net.createServer();probe.listen(0,'127.0.0.1');await new Promise(r=>probe.once('listening',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const server=spawn(process.env.MONGOD_BINARY,['--dbpath',join(dir,'db'),'--bind_ip','127.0.0.1','--port',String(port),'--auth','--wiredTigerCacheSizeGB','0.25'],{stdio:['ignore',log.fd,log.fd]}),closed=new Promise(r=>server.once('exit',r));let bootstrap,admin,app;
 t.after(async()=>{await app?.close();await admin?.close();await bootstrap?.close();if(server.exitCode===null)server.kill('SIGTERM');await closed;await log.close();await rm(dir,{recursive:true,force:true});});
 const uri=`mongodb://127.0.0.1:${port}/`,rootPassword=randomBytes(32).toString('hex'),password=randomBytes(32).toString('hex');
 for(let attempt=0;attempt<60;attempt++){bootstrap=new MongoClient(uri,{serverSelectionTimeoutMS:250});try{await bootstrap.connect();break;}catch{await bootstrap.close();bootstrap=null;await new Promise(r=>setTimeout(r,100));}}
 assert.ok(bootstrap,'Local auth fixture failed to start');await bootstrap.db('admin').command({createUser:'synthetic_bootstrap',pwd:rootPassword,roles:[{role:'root',db:'admin'}]});await bootstrap.close();
 admin=await new MongoClient(uri,{auth:{username:'synthetic_bootstrap',password:rootPassword},authSource:'admin'}).connect();await admin.db('navi_role_scope').command({createUser:'synthetic_app',pwd:password,roles:[{role:'readWrite',db:'navi_role_scope'}]});
 app=await new MongoClient(uri,{auth:{username:'synthetic_app',password},authSource:'navi_role_scope'}).connect();const c=app.db('navi_role_scope').collection('journeys');await c.createIndex({ownerId:1});await c.insertOne({_id:'SYNTHETIC',ownerId:'SYNTHETIC_OWNER'});assert.equal((await c.findOne({_id:'SYNTHETIC'})).ownerId,'SYNTHETIC_OWNER');
 for(const operation of [()=>app.db('navi_other_scope').collection('journeys').findOne({}),()=>app.db('navi_other_scope').collection('journeys').insertOne({_id:'DENIED'}),()=>app.db('admin').command({createUser:'forbidden',pwd:'SYNTHETIC-NOT-USED',roles:[]})])await assert.rejects(operation,{code:13});
 assert.equal((await admin.db('navi_other_scope').collection('journeys').countDocuments()),0);
});
