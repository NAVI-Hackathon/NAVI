import test from'node:test';import assert from'node:assert/strict';import{loadConfig}from'../src/config/env.js';import{createGeminiProvider}from'../src/services/gemini.service.js';
test('legacy transport also preserves temporary 503 instead of reclassifying it as a generic gateway error',async()=>{
 let calls=0;const config=loadConfig({AI_MODE:'live',GEMINI_API_KEY:'synthetic-test-key',GEMINI_FREE_TIER_CONFIRMED:'true',AI_MAX_ATTEMPTS:'1'});
 const provider=createGeminiProvider(config,async()=>{calls++;return Response.json({error:{code:503,status:'UNAVAILABLE',message:'private upstream diagnostic'}},{status:503});});
 await assert.rejects(provider.understandIntent('合成住院測試'),e=>e.code==='AI_PROVIDER_ERROR'&&e.status===503&&e.retryable&&!e.message.includes('private upstream'));assert.equal(calls,1);
});
