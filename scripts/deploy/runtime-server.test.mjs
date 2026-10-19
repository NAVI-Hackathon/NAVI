import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createStaticServer } from './runtime-server.mjs';
async function fixture(t, role, apiPort=1) {
  const root=await mkdtemp(path.join(os.tmpdir(),'navi-server-test-'));
  await writeFile(path.join(root,'index.html'),'NAVI index'); await writeFile(path.join(root,'404.html'),'NAVI 404');
  await mkdir(path.join(root,'services'));await writeFile(path.join(root,'services/claims.html'),'claims');await writeFile(path.join(root,'services/claims.txt'),'rsc payload');
  await symlink('/etc/passwd',path.join(root,'escape'));
  const server=await createStaticServer({root,role,apiPort});server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
  return `http://127.0.0.1:${server.address().port}`;
}
test('clean mock routes, RSC, 404 and HEAD work without Next runtime',async t=>{
  const base=await fixture(t,'mock');
  assert.equal(await (await fetch(base+'/services/claims?focus=claim-doc-2')).text(),'claims');
  const r=await fetch(base+'/services/claims.txt?_rsc=example');assert.equal(r.headers.get('content-type'),'text/x-component');assert.equal(await r.text(),'rsc payload');
  assert.equal((await fetch(base+'/missing')).status,404);assert.equal((await fetch(base+'/services/claims',{method:'HEAD'})).status,200);
});
test('SPA deep links work, missing assets and path escapes cannot expose files',async t=>{
  const base=await fixture(t,'web');
  for(const p of ['/','/embed','/demo'])assert.equal(await(await fetch(base+p)).text(),'NAVI index');
  for(const p of ['/escape','/%2Eenv','/assets/no.js','/../etc/passwd'])assert.equal((await fetch(base+p)).status,404);
});
test('same-origin API proxy streams methods/body and handles backend failure',async t=>{
  const api=http.createServer((req,res)=>{let text='';req.on('data',d=>text+=d);req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({method:req.method,path:req.url,body:text,origin:req.headers.origin}));});});
  api.listen(0,'127.0.0.1');await new Promise(r=>api.once('listening',r));
  t.after(()=>new Promise(r=>api.close(r)));
  const base=await fixture(t,'web',api.address().port);
  const r=await fetch(base+'/api/journeys',{method:'POST',headers:{Origin:'http://127.0.0.1:18171'},body:'synthetic'});
  assert.deepEqual(await r.json(),{method:'POST',path:'/api/journeys',body:'synthetic',origin:'http://127.0.0.1:18171'});
  api.closeAllConnections();await new Promise(r=>api.close(r));
  assert.equal((await fetch(base+'/api/health')).status,502);
});
