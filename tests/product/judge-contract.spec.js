import {test,expect} from '@playwright/test';
import {judgeConversationFixtures} from '../fixtures/judge-conversation.js';
// E13: actual A Renderer with deterministic API contracts, never a Live Gemini call.
for(const [name,reply]of Object.entries(judgeConversationFixtures).filter(([name])=>name!=='aiSuccess'))test('E13 Renderer contract: '+name,async({page},info)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const body=path==='/api/ai/status'?{mode:'live',available:true,syntheticOnly:true,product:{enabled:true}}:path==='/api/session'?{authenticated:false,authRequired:false,consentAccepted:true,syntheticOnly:true}:path==='/api/conversations/messages'?reply:path==='/api/history'?{journeys:[],conversations:[]}:{};
  await route.fulfill({status:200,headers:{'Content-Type':'application/json','X-NAVI-AI-Mode':'live'},body:JSON.stringify(body)});
 });
 await page.goto('/embed');await expect(page.locator('#story-input')).toBeVisible();await page.locator('#story-input').fill(name==='clarification'?'我不知道要辦什麼':'我要改通訊地址');await page.locator('#story-input').press('Enter');await page.waitForTimeout(1400);
 await info.attach('renderer-errors',{body:JSON.stringify({fixture:name,errors}),contentType:'application/json'});await page.screenshot({path:info.outputPath('renderer.png')});
 expect(errors).toEqual([]);await expect(page.locator('#story-input')).toBeVisible();
 if(reply.evidence.status==='answered')await expect(page.getByText('在官網資料中找到：')).toBeVisible();else await expect(page.getByText(reply.answer,{exact:true}).last()).toBeVisible();
});
