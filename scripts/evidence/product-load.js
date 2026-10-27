import {performance} from 'node:perf_hooks';
import {createApp} from '../../apps/api/src/app.js';
import {createDemoProvider} from '../../apps/api/src/ai/demoProvider.js';
import {fixture,config,store} from '../../apps/api/test/mongoTestSupport.js';
import {offlineNetworkStats} from '../../apps/api/test/networkGuard.js';
import {latencySummary} from '../evidence-pack.js';
const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)}),c=config(f,{rateLimit:1000});c.store=await store(f);
const app=createApp(c,{...createDemoProvider(),mode:'live'}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}/api`,origin='https://app.navitw.com';let cookie='';
async function request(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});cookie=r.headers.get('set-cookie')?.split(';')[0]??cookie;if(!r.ok)throw Error('Unexpected synthetic load status '+r.status);return r.json();}
try{
 await request('/session');await request('/session/consent',{syntheticOnly:true,disclosureVersion:'gemini-unpaid-2026-10'});const j=await request('/journeys',{message:'我在合成醫院住院五天'}),levels=[];
 for(const concurrency of [1,2,4]){let index=0,errors=0;const latencies=[],cpu=process.cpuUsage(),rssBefore=process.memoryUsage().rss,start=performance.now();await Promise.all(Array.from({length:concurrency},async()=>{while(index++<24){const began=performance.now();try{const actual=await request('/journeys/'+j.id);if(actual.readiness!==35)throw Error('state');}catch{errors++;}latencies.push(performance.now()-began);}}));const elapsed=performance.now()-start;levels.push({concurrency,requests:latencies.length,errors,errorRate:errors/latencies.length,throughputPerSecond:latencies.length/(elapsed/1000),latencyMs:latencySummary(latencies),rssBefore,rssAfter:process.memoryUsage().rss,cpuMicros:process.cpuUsage(cpu)});}
 console.info(JSON.stringify({kind:'local_real_mongodb_mock_provider_load',at:new Date().toISOString(),levels,geminiRequests:0,externalNetwork:offlineNetworkStats(),limitations:'Loopback and local replica set; not production latency or real Gemini quality.'},null,2));if(levels.some(l=>l.errors))process.exitCode=1;
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await app.locals.close();for(const fn of cleanups)await fn();}
