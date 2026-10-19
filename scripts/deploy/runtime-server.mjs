import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.txt':'text/x-component', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon', '.woff2':'font/woff2', '.pdf':'application/pdf', '.xml':'application/xml' };
export async function createStaticServer({ root, role, apiPort, allowedHost }) {
  root = await realpath(root);
  const send = (res, code, text) => { res.writeHead(code, { 'Content-Type':'text/plain; charset=utf-8' }); res.end(text); };
  return http.createServer({ requestTimeout:30000, headersTimeout:15000 }, async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy', `frame-ancestors 'self'${role === 'web' ? ' http://127.0.0.1:18173' : ''}`);
    if (allowedHost && req.headers.host !== allowedHost) return send(res,421,'不支援此主機名稱，請使用指定的 SSH Tunnel 網址。');
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return send(res,400,'無效網址。'); }
    if (role === 'web' && (url.pathname === '/api' || url.pathname.startsWith('/api/'))) {
      if (!['GET','HEAD','POST','DELETE','OPTIONS'].includes(req.method)) return send(res,405,'不支援此操作。');
      if (Number(req.headers['content-length'] ?? 0) > 11 * 1024 * 1024) return send(res,413,'文件過大。');
      const upstream = http.request({ hostname:'127.0.0.1',port:apiPort,method:req.method,path:req.url,headers:{...req.headers,host:`127.0.0.1:${apiPort}`},timeout:15000 }, reply => {
        res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
        reply.on('error',()=>res.destroy());
      });
      upstream.on('timeout',()=>upstream.destroy());
      upstream.on('error',()=> { if (!res.headersSent) { res.writeHead(502,{'Content-Type':'application/json'}); res.end(JSON.stringify({success:false,error:{code:'API_UNAVAILABLE',message:'服務暫時無法使用，請稍後再試。',retryable:true}})); } else res.destroy(); });
      req.on('aborted',()=>upstream.destroy()); res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});
      req.pipe(upstream); return;
    }
    if (!['GET','HEAD'].includes(req.method)) return send(res,405,'不支援此操作。');
    if (url.pathname === '/__navi_health') { res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify({status:'ok',role})); }
    let name;
    try { name = decodeURIComponent(url.pathname); } catch { return send(res,400,'無效網址。'); }
    if (name.split('/').some(p=>p.startsWith('.') || p.includes('\\')) || name.includes('\0')) return send(res,404,'找不到頁面。');
    const base = path.resolve(root, '.' + name);
    if (!base.startsWith(root + path.sep) && base !== root) return send(res,404,'找不到頁面。');
    const candidates = [base, base + '.html', path.join(base,'index.html')];
    if (role === 'web' && ['/','/embed','/demo'].includes(name)) candidates.push(path.join(root,'index.html'));
    let file, info;
    for (const candidate of candidates) {
      try { const actual = await realpath(candidate); if (!actual.startsWith(root+path.sep)) continue; const s = await stat(actual); if (s.isFile()) { file=actual; info=s; break; } } catch { /* Absent candidates are normal for clean routes. */ }
    }
    let status=200;
    if (!file && role === 'mock') { file=path.join(root,'404.html'); try{info=await stat(file);status=404;}catch{file=null;} }
    if (!file) return send(res,404,'找不到頁面。');
    res.setHeader('Content-Type',types[path.extname(file)] ?? 'application/octet-stream');
    res.setHeader('Content-Length',info.size);
    res.setHeader('Cache-Control',name.startsWith('/_next/static/') || name.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store');
    res.writeHead(status);
    if (req.method === 'HEAD') return res.end();
    const stream=createReadStream(file); stream.on('error',()=>res.destroy()); stream.pipe(res);
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [role,root,port,apiPort] = process.argv.slice(2);
  if (!['web','mock'].includes(role) || !/^\d+$/.test(port) || !/^\d+$/.test(apiPort)) throw new Error('Invalid NAVI server arguments');
  const server = await createStaticServer({root,role,apiPort:Number(apiPort),allowedHost:`127.0.0.1:${port}`});
  server.listen(Number(port),'127.0.0.1',()=>console.info(`NAVI ${role} listening on 127.0.0.1:${port}`));
  for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref();});
}
