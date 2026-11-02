import {test,expect} from '@playwright/test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createApp} from '../../apps/api/src/app.js';
import {loadConfig} from '../../apps/api/src/config/env.js';
import {createGeminiProvider} from '../../apps/api/src/services/gemini.service.js';
import {MongoStore} from '../../apps/api/src/storage/mongoStore.js';
import {TEST_URI} from '../../apps/api/test/mongoTestSupport.js';
import {createDemoProvider} from '../../apps/api/src/ai/demoProvider.js';

// A3 frontend integration against the real persistent API (isolated local MongoDB, Gemini transport mocked
// with the demo understanding — no model call). Configured like production today: public registration
// closed and no e-mail delivery, so only actions the server can complete may be offered.
const origin='https://app.navitw.com';

async function persistentBackend(page){
 const dir=mkdtempSync(join(tmpdir(),'navi-a3-'));
 const config=loadConfig({NAVI_PRODUCT_MODE:'true',MONGODB_URI:TEST_URI,MONGODB_DATABASE:'navi_test_a3_'+randomBytes(10).toString('hex'),NAVI_PRIVATE_STATE_PATH:dir,NAVI_DATA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),AI_MODE:'live',GEMINI_API_KEY:'synthetic-mock-key',GEMINI_FREE_TIER_CONFIRMED:'true',AI_PUBLIC_SYNTHETIC:'true',AI_SYNTHETIC_TEST_ONLY:'true',WEB_ORIGINS:origin});
 config.production=true; // registration closed without SMTP, as on app.navitw.com
 const demo=createDemoProvider();
 const provider=createGeminiProvider(config,async(url,options)=>{
  if(!options.method)return Response.json({models:[{name:'models/'+config.model,supportedGenerationMethods:['generateContent']}]});
  const input=JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
  const raw={...await demo.understandTasks(input.message),answer:input.sources.length?{answer:input.sources[0].content,sourceIds:[input.sources[0].id],confidence:.9,supported:true}:{answer:'目前提供的資料不足以確認。',sourceIds:[],confidence:0,supported:false}};
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]});
 });
 config.store=await new MongoStore({uri:config.mongoUri,database:config.mongoDatabase,key:config.dataEncryptionKey}).connect();
 const app=createApp(config,provider),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;let cookie;
 await page.route('**/api/**',async route=>{
  const req=route.request(),r=await fetch(base+new URL(req.url()).pathname+new URL(req.url()).search,{method:req.method(),headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(req.headers()['content-type']?{'Content-Type':req.headers()['content-type']}:{})},...(req.postDataBuffer()?{body:req.postDataBuffer()}:{})});
  cookie=r.headers.get('set-cookie')?.split(';')[0]??cookie;
  await route.fulfill({status:r.status,headers:{'Content-Type':'application/json','X-NAVI-AI-Mode':r.headers.get('X-NAVI-AI-Mode')??'live'},body:await r.text()}).catch(()=>{});
 });
 const close=async()=>{await page.unrouteAll({behavior:'wait'}).catch(()=>{});server.closeAllConnections();await new Promise(r=>server.close(r));await config.store.db.dropDatabase();await app.locals.close();rmSync(dir,{recursive:true,force:true});};
 return {close,status:path=>fetch(base+'/api'+path,{headers:{Origin:origin,Cookie:cookie}}).then(r=>r.status)};
}

const privacyButton=page=>page.getByRole('button',{name:'資料與隱私',exact:true});
async function consent(page){
 await privacyButton(page).click();const dialog=page.getByRole('dialog',{name:'資料與隱私'});
 await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'確認並繼續'}).click();
 await dialog.getByRole('button',{name:'關閉',exact:true}).click();await expect(dialog).toHaveCount(0);
}
async function ask(page,text){await page.locator('#story-input').fill(text);await page.locator('#story-input').press('Enter');}

test('one 資料與隱私 entry with the server retention; only account actions the server can complete',async({page})=>{
 const backend=await persistentBackend(page);
 try{
  await page.setViewportSize({width:390,height:844});await page.goto('/embed');
  await expect(page.getByRole('button',{name:'我的資料與歷程'})).toHaveCount(0);
  await privacyButton(page).click();
  const dialog=page.getByRole('dialog',{name:'資料與隱私'});
  await expect(dialog).toContainText('自最後一次異動起保存 30 天');
  await expect(dialog).toContainText('既有備份約 7 天內例行輪替清除');
  await expect(dialog).not.toContainText('1 小時');
  await dialog.getByLabel('電子郵件或測試帳號').fill('someone@example.invalid');
  await expect(dialog.getByText('公開帳號註冊尚未開放')).toBeVisible();
  await expect(dialog.getByRole('button',{name:'登入',exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'建立帳號並保存'})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'忘記密碼'})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'重新寄送驗證信'})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await backend.close();}
});

for(const width of [390,1280])test(`刪除這件事 deletes it on the server; a failure says so and keeps it — ${width}px`,async({page})=>{
 const backend=await persistentBackend(page);
 try{
  await page.setViewportSize({width,height:900});await page.goto('/embed');
  await consent(page);
  await ask(page,'我搬家了，要變更保單地址');
  await page.getByRole('button',{name:'開啟工作區'}).click();
  await expect(page.getByRole('heading',{name:'地址變更',exact:true,level:1})).toBeVisible();
  const id=JSON.parse(await page.evaluate(()=>localStorage.getItem('navi.journey'))).current;
  expect(await backend.status('/journeys/'+id)).toBe(200);

  await privacyButton(page).click();
  const dialog=page.getByRole('dialog',{name:'資料與隱私'});
  const section=dialog.getByRole('region',{name:/「地址變更.*」的資料/});
  await expect(section).toContainText('會從 NAVI 服務一起刪除');
  // The server cannot store right now: nothing is shown as deleted and the journey stays.
  await page.route('**/api/journeys/'+id,route=>route.request().method()==='DELETE'?route.fulfill({status:503,headers:{'Content-Type':'application/json'},body:JSON.stringify({success:false,error:{code:'STORAGE_UNAVAILABLE',message:'storage',retryable:true}})}):route.fallback());
  await section.getByRole('button',{name:'刪除這件事'}).click();
  await section.getByRole('button',{name:'確定刪除'}).click();
  await expect(page.getByText('沒有刪除這件事。NAVI 暫時無法存取保存的資料')).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(await backend.status('/journeys/'+id)).toBe(200);

  await page.unroute('**/api/journeys/'+id);
  await section.getByRole('button',{name:'刪除這件事'}).click();
  await section.getByRole('button',{name:'確定刪除'}).click();
  await expect(page.getByText('已刪除這件事。線上資料已移除；既有備份約 7 天內例行輪替清除。')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#story-input')).toBeVisible();
  expect(await backend.status('/journeys/'+id)).toBe(404);
  await page.reload();
  await expect(page.getByRole('button',{name:'開啟工作區'})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await backend.close();}
});

test('a conflict (409) offers 重新載入 instead of sending the message again',async({page})=>{
 const backend=await persistentBackend(page);
 try{
  await page.setViewportSize({width:390,height:844});await page.goto('/embed');
  await consent(page);
  let sent=0;
  await page.route('**/api/conversations/messages',route=>{sent++;return route.fulfill({status:409,headers:{'Content-Type':'application/json','X-NAVI-AI-Mode':'live'},body:JSON.stringify({success:false,error:{code:'CONVERSATION_INCOMPLETE',message:'conflict',retryable:false}})});});
  await ask(page,'我搬家了，要變更保單地址');
  await expect(page.getByText('上一則訊息還沒有處理完成')).toBeVisible();
  await expect(page.getByRole('button',{name:'重新分析'})).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(sent).toBe(1);
  await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'重新載入'}).click()]);
  expect(sent).toBe(1);
  await expect(page.locator('#story-input')).toBeVisible();
 }finally{await backend.close();}
});
