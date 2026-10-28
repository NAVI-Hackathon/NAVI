// Starts only an isolated loopback replica set for tests, never MongoDB on a VPS.
import {spawn,spawnSync} from 'node:child_process';
import {MongoClient} from 'mongodb';
import {mkdtemp,mkdir,readdir,open,writeFile,rm,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import net from 'node:net';
const args=process.argv.slice(2);if(args[0]==='--')args.shift();if(!args.length)throw Error('Pass a test command after --');
if(process.env.MONGODB_TEST_URI){if(!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(process.env.MONGODB_TEST_URI))throw Error('Tests must not use Atlas');const p=spawn(args[0],args.slice(1),{stdio:'inherit',env:process.env});p.on('exit',code=>process.exitCode=code??1);}
else{
 const runtime=resolve('artifacts/mongo-runtime'),candidates=process.env.MONGOD_BINARY?[process.env.MONGOD_BINARY]:[];
 for(const name of await readdir(runtime).catch(()=>[]))if(name.startsWith('mongodb-macos-'))candidates.push(join(runtime,name,'bin/mongod'));
 candidates.push('mongod');
 const binary=candidates.find(path=>path&&spawnSync(path,['--version'],{stdio:'ignore',timeout:10000}).status===0);
 if(!binary)throw Error('Set MONGOD_BINARY to an official MongoDB community binary; production never runs mongod. See docs/a3-persistence-contract.md.');
 const root=resolve('artifacts/mongo-tests');await mkdir(root,{recursive:true,mode:0o700});const dir=await mkdtemp(join(root,'run-'));await writeFile(join(dir,'.navi-test-marker'),'isolated local test replica set');await mkdir(join(dir,'db'),{mode:0o700});
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const log=await open(join(dir,'server.log'),'w',0o600),server=spawn(binary,['--dbpath',join(dir,'db'),'--bind_ip','127.0.0.1','--port',String(port),'--replSet','naviTest','--wiredTigerCacheSizeGB','0.25'],{stdio:['ignore',log.fd,log.fd]});
 let running;const closed=new Promise(r=>server.once('exit',r));server.on('error',e=>console.error(e.message));
 const stop=()=>{running?.kill('SIGTERM');server.kill('SIGTERM');};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  let client;for(let n=0;n<80;n++){try{client=new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`,{serverSelectionTimeoutMS:250});await client.connect();break;}catch{await client?.close();client=null;await new Promise(r=>setTimeout(r,100));}}
  if(!client)throw Error('Test MongoDB did not start');
  try{await client.db('admin').command({replSetInitiate:{_id:'naviTest',members:[{_id:0,host:`127.0.0.1:${port}`}]}});let ready=false;for(let n=0;n<80;n++){if((await client.db('admin').command({hello:1})).isWritablePrimary){ready=true;break;}await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error('Test replica set not ready');}finally{await client.close();}
  console.info('Isolated MongoDB replica set ready; no Atlas or Gemini requests.');
  running=spawn(args[0],args.slice(1),{stdio:'inherit',env:{...process.env,MONGODB_TEST_URI:`mongodb://127.0.0.1:${port}/?replicaSet=naviTest`}});process.exitCode=await new Promise(r=>running.once('exit',code=>r(code??1)));
 }finally{server.kill('SIGTERM');await closed;await log.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);const stat=await lstat(dir);if(!stat.isSymbolicLink()&&stat.uid===process.getuid()&&dir.startsWith(root+'/run-'))await rm(join(dir,'db'),{recursive:true,force:true});}
}
