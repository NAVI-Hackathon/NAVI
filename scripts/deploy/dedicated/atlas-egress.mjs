// Root-only NAVI egress refresh: retain the original policy and allow only current Atlas DNS targets.
import {readFileSync,lstatSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {resolveSrv,resolve4,resolve6} from 'node:dns/promises';
import {isIP} from 'node:net';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const ROOT='/opt/navi-hackathon',UNIT='navi-api.service',STATE=ROOT+'/config/atlas-egress-state.json';
export function atlasHostname(uri){
 if(!uri?.startsWith('mongodb+srv://')||/[?&](?:tls|ssl)=false|tlsAllowInvalid|tlsInsecure/i.test(uri))throw Error('UNSAFE_ATLAS_CONFIGURATION');
 const host=new URL(uri).hostname;
 if(!/^[a-z0-9.-]+\.mongodb\.net$/.test(host))throw Error('UNTRUSTED_ATLAS_HOST');
 return host;
}
export async function atlasAddresses(uri,dns={resolveSrv,resolve4,resolve6}){
 const targets=await dns.resolveSrv('_mongodb._tcp.'+atlasHostname(uri));
 if(!targets.length||targets.length>20||targets.some(t=>!t.name.endsWith('.mongodb.net')||t.port!==27017))throw Error('UNTRUSTED_ATLAS_TARGET');
 const addresses=[];
 for(const target of targets){
  const v4=await dns.resolve4(target.name).catch(()=>[]),v6=await dns.resolve6(target.name).catch(()=>[]);
  if(!v4.length&&!v6.length)throw Error('ATLAS_DNS_UNAVAILABLE');
  for(const ip of [...v4,...v6]){
   const version=isIP(ip);
   if(!version||/^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip)||/^(?:fc|fd|fe80|::)/i.test(ip))throw Error('NONPUBLIC_ATLAS_ADDRESS');
   addresses.push(ip+(version===4?'/32':'/128'));
  }
 }
 return [...new Set(addresses)].sort();
}
function atomic(path,data){const temp=path+'.'+process.pid+'.new';try{writeFileSync(temp,data,{mode:0o600,flag:'wx'});renameSync(temp,path);}finally{try{unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}}
function command(args){return execFileSync('systemctl',args,{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}).trim();}
export function applyPolicy(addresses,run=command){
 const actual=()=>run(['show',UNIT,'-p','IPAddressAllow','--value']).split(/\s+/).filter(Boolean).sort();
 const expected=[...addresses].sort();
 if(JSON.stringify(actual())===JSON.stringify(expected))return;
 // systemd appends address lists; explicitly reset before replacing rotated Atlas targets.
 run(['set-property','--runtime',UNIT,'IPAddressAllow=']);
 run(['set-property','--runtime',UNIT,'IPAddressAllow='+expected.join(' ')]);
 if(JSON.stringify(actual())!==JSON.stringify(expected))throw Error('Policy mismatch');
}
function trusted(path){const s=lstatSync(path,{throwIfNoEntry:false});if(!s||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))throw Error('UNSAFE_DEPLOYMENT_PATH');}
async function main(){
 if(process.getuid()!==0)throw Error('ROOT_REQUIRED');
 for(const path of [ROOT,ROOT+'/config',ROOT+'/.dedicated-marker.json',ROOT+'/config/api.env'])trusted(path);
 const marker=JSON.parse(readFileSync(ROOT+'/.dedicated-marker.json','utf8'));
 if(marker.kind!=='navi-dedicated-vps'||marker.root!==ROOT||command(['show',UNIT,'-p','FragmentPath','--value'])!=='/etc/systemd/system/'+UNIT)throw Error('WRONG_NAVI_SERVICE');
 process.loadEnvFile(ROOT+'/config/api.env');
 const atlas=await atlasAddresses(process.env.MONGODB_URI);
 const current=command(['show',UNIT,'-p','IPAddressAllow','--value']).split(/\s+/).filter(Boolean);
 let state;
 try{trusted(STATE);state=JSON.parse(readFileSync(STATE,'utf8'));}catch(e){if(e.code!=='ENOENT'&&e.message!=='UNSAFE_DEPLOYMENT_PATH')throw e;if(lstatSync(STATE,{throwIfNoEntry:false}))throw e;state={kind:'navi-atlas-egress-v1',baseAddresses:current};}
 if(state.kind!=='navi-atlas-egress-v1'||!Array.isArray(state.baseAddresses)||!state.baseAddresses.length||state.baseAddresses.some(ip=>!['127.0.0.0/8','::1/128'].includes(ip)&&!(/\/(?:32|128)$/.test(ip)&&isIP(ip.split('/')[0]))))throw Error('UNSAFE_BASE_POLICY');
 const allowed=[...new Set([...state.baseAddresses,...atlas])].sort();
 if(!process.argv.includes('--apply')){console.log(JSON.stringify({dryRun:true,baseAddresses:state.baseAddresses.length,atlasAddresses:atlas.length,totalAddresses:allowed.length}));return;}
 const dropin='/etc/systemd/system/'+UNIT+'.d/30-atlas-egress.conf';
 const text='[Unit]\nWants=navi-atlas-egress.service\nAfter=navi-atlas-egress.service\n[Service]\nIPAddressAllow=\nIPAddressAllow='+allowed.join(' ')+'\n';
 let previous='';try{previous=readFileSync(dropin,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 if(previous!==text){atomic(dropin,text);command(['daemon-reload']);}
 try{applyPolicy(allowed);}catch{applyPolicy(current);throw Error('ATLAS_EGRESS_APPLY_FAILED');}
 atomic(STATE,JSON.stringify({...state,atlasAddresses:atlas,updatedAt:new Date().toISOString()},null,2)+'\n');
 console.log(JSON.stringify({updated:true,atlasAddresses:atlas.length,totalAddresses:allowed.length}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('NAVI Atlas egress refresh failed; retained last verified policy.');process.exitCode=1;});
