// Keep the normal drain shorter than systemd's 10-second stop deadline.
export function installShutdown({server,app,signals=process,exit=code=>process.exit(code),graceMs=5000,deadlineMs=9000}){
 let stopping=false;
 server.on('request',(req,res)=>res.once('finish',()=>{if(stopping)setImmediate(()=>server.closeIdleConnections());}));
 const shutdown=()=>{
  if(stopping)return;stopping=true;app.locals.draining=true;
  const force=setTimeout(()=>server.closeAllConnections(),graceMs);force.unref();
  const deadline=setTimeout(()=>{
   console.warn(JSON.stringify({event:'shutdown_incomplete'}));server.closeAllConnections();
   Promise.resolve().then(()=>app.locals.store?.close()).catch(()=>{});
   exit(1);
  },deadlineMs);deadline.unref();
  server.close(async()=>{
   try{await app.locals.close?.();clearTimeout(force);clearTimeout(deadline);exit(0);}
   catch{clearTimeout(force);clearTimeout(deadline);console.warn(JSON.stringify({event:'shutdown_failed'}));exit(1);}
  });
  server.closeIdleConnections();
 };
 signals.once('SIGINT',shutdown);signals.once('SIGTERM',shutdown);
 return shutdown;
}
