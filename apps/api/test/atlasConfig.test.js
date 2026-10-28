import test from 'node:test';
import assert from 'node:assert/strict';
import {atlasAddresses,atlasHostname,applyPolicy} from '../../../scripts/deploy/dedicated/atlas-egress.mjs';

test('Atlas egress accepts only trusted SRV targets and public host addresses', async()=>{
 const uri='mongodb+srv://synthetic:never-a-secret@cluster.test.mongodb.net/navi';
 assert.equal(atlasHostname(uri),'cluster.test.mongodb.net');
 const dns={resolveSrv:async()=>[{name:'node.test.mongodb.net',port:27017}],resolve4:async()=>['203.0.113.20'],resolve6:async()=>[]};
 assert.deepEqual(await atlasAddresses(uri,dns),['203.0.113.20/32']);
 for(const value of ['mongodb://localhost/navi','mongodb+srv://host.invalid/navi',uri+'?tls=false'])assert.throws(()=>atlasHostname(value));
 await assert.rejects(atlasAddresses(uri,{...dns,resolveSrv:async()=>[{name:'untrusted.invalid',port:27017}]}));
 await assert.rejects(atlasAddresses(uri,{...dns,resolve4:async()=>['169.254.169.254']}));
 await assert.rejects(atlasAddresses(uri,{...dns,resolve4:async()=>[]}));
});

test('Atlas egress replaces accumulated addresses and leaves unchanged policies untouched',()=>{
 let addresses=['203.0.113.1/32','127.0.0.0/8'],writes=0;
 const run=args=>{if(args[0]==='show')return addresses.join(' ');writes++;const value=args.at(-1).slice('IPAddressAllow='.length);addresses=value?[...new Set([...addresses,...value.split(' ')])]:[];return '';};
 applyPolicy(['127.0.0.0/8','203.0.113.2/32'],run);
 assert.deepEqual(addresses,['127.0.0.0/8','203.0.113.2/32']);assert.equal(writes,2);
 applyPolicy(['203.0.113.2/32','127.0.0.0/8'],run);assert.equal(writes,2);
});
