import test from 'node:test';import assert from 'node:assert/strict';import http from'node:http';import{EventEmitter}from'node:events';import{installShutdown}from'../src/utils/shutdown.js';
test('shutdown drains a real active HTTP request and closes storage once across duplicate signals',async t=>{
 let received,finish,closes=0;const entered=new Promise(r=>received=r),exited=[];const server=http.createServer(async(req,res)=>{received();await new Promise(r=>finish=r);res.end('saved');});server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.closeAllConnections());
 const signals=new EventEmitter(),app={locals:{close:async()=>{closes++;}}};let done;const end=new Promise(r=>done=r);
 installShutdown({server,app,signals,exit:code=>{exited.push(code);done();},graceMs:1000,deadlineMs:1500});
 const request=fetch(`http://127.0.0.1:${server.address().port}`);await entered;signals.emit('SIGTERM');signals.emit('SIGINT');assert.equal(app.locals.draining,true);finish();assert.equal(await(await request).text(),'saved');await end;assert.equal(closes,1);assert.deepEqual(exited,[0]);
});
test('unfinished storage close has a bounded failure exit and sanitized event',async t=>{
 const server=http.createServer((req,res)=>res.end());server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let forceClose=0,done;const result=new Promise(r=>done=r);const keep=setTimeout(()=>{},1000);t.after(()=>{clearTimeout(keep);server.closeAllConnections();});
 const app={locals:{close:()=>new Promise(()=>{}),store:{close:async()=>{forceClose++;}}}};
 installShutdown({server,app,signals:new EventEmitter(),exit:done,graceMs:10,deadlineMs:25})();assert.equal(await result,1);await new Promise(r=>setImmediate(r));assert.equal(forceClose,1);
});

test('startup DB failure exits without listening and never logs the private URI',async()=>{
 const {spawn}=await import('node:child_process'),{randomBytes}=await import('node:crypto'),net=await import('node:net'),{mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await new Promise(r=>reservation.once('listening',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));const dir=mkdtempSync(join(tmpdir(),'navi-startup-'));
 try{const child=spawn(process.execPath,['apps/api/src/server.js'],{cwd:new URL('../../../',import.meta.url),env:{PATH:process.env.PATH,NODE_ENV:'test',AI_MODE:'unavailable',NAVI_PRODUCT_MODE:'true',MONGODB_URI:`mongodb://127.0.0.1:${port}/?replicaSet=naviTest`,MONGODB_DB_NAME:'navi_test_startup',NAVI_DATA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),NAVI_PRIVATE_STATE_PATH:dir},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);assert.equal(await new Promise(r=>child.once('exit',r)),1);assert.match(output,/startup_failed/);assert.doesNotMatch(output,/listening|mongodb:\/\/|replicaSet|password/);}finally{rmSync(dir,{recursive:true,force:true});}
});
