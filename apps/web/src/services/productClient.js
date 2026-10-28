import {ConversationReplySchema} from '../../../../shared/product.js';
import {getKnowledgeEntry,verifyEvidenceSnippet} from '../../../../shared/knowledge/index.js';
export function createProductClient(request,storage){
 let enabled=false,id=null;
 const key='navi.product.conversation';
 try{id=storage?.getItem(key)??null;}catch{/* Storage is optional. */}
 return {
  get enabled(){return enabled;},
  async init(){const status=await request('/ai/status',{schema:null});enabled=status.product?.enabled===true;if(!enabled)return null;const session=await request('/session',{schema:null});let conversation=null;if(id)try{conversation=await request('/conversations/'+id,{schema:null});}catch{storage?.removeItem(key);id=null;}return {session,conversation};},
  async send(message,signal){const result=await request('/conversations/messages',{method:'POST',json:{message,...(id?{conversationId:id}:{}),requestId:crypto.randomUUID()},signal,timeout:90000,schema:ConversationReplySchema});id=result.conversationId;try{storage?.setItem(key,id);}catch{/* In-memory history remains usable. */}return result;},
  reset(){id=null;try{storage?.removeItem(key);}catch{/* Storage is optional. */}},
  result(reply){const results=reply.evidence.results.map(r=>getKnowledgeEntry(r.source.id)).filter(Boolean);const highlights=Object.fromEntries(reply.evidence.results.map(r=>[r.source.id,r.excerpts.filter(t=>verifyEvidenceSnippet(r.source.id,t))]));return {status:reply.evidence.status,results,related:[],highlights,hotline:reply.evidence.hotline};},
 };
}
