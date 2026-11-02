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
for(const width of [390,1280])test(`persistent formal conversation, consent and address preparation — ${width}px`,async({page})=>{
 const dir=mkdtempSync(join(tmpdir(),'navi-browser-')),origin='https://app.navitw.com';let cookie,calls=0;
 const config=loadConfig({NAVI_PRODUCT_MODE:'true',MONGODB_URI:TEST_URI,MONGODB_DATABASE:'navi_test_browser_'+randomBytes(10).toString('hex'),NAVI_PRIVATE_STATE_PATH:dir,NAVI_DATA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),AI_MODE:'live',GEMINI_API_KEY:'synthetic-mock-key',GEMINI_FREE_TIER_CONFIRMED:'true',AI_PUBLIC_SYNTHETIC:'true',AI_SYNTHETIC_TEST_ONLY:'true',WEB_ORIGINS:origin});
 const demo=createDemoProvider();
 const provider=createGeminiProvider(config,async(url,options)=>{
  if(!options.method)return Response.json({models:[{name:'models/'+config.model,supportedGenerationMethods:['generateContent']}]});
  calls++;const body=JSON.parse(options.body),input=JSON.parse(body.contents[0].parts[0].text);
  const raw={...await demo.understandTasks(input.message),answer:input.sources.length?{answer:input.sources[0].content,sourceIds:[input.sources[0].id],confidence:.9,supported:true}:{answer:'目前提供的資料不足以確認。',sourceIds:[],confidence:0,supported:false}};
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]});
 });
 config.store=await new MongoStore({uri:config.mongoUri,database:config.mongoDatabase,key:config.dataEncryptionKey}).connect();
 const app=createApp(config,provider),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 await page.route('**/api/**',async route=>{
  const req=route.request(),r=await fetch(base+new URL(req.url()).pathname,{method:req.method(),headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(req.headers()['content-type']?{'Content-Type':req.headers()['content-type']}: {})},...(req.postDataBuffer()?{body:req.postDataBuffer()}: {})});if(r.status>=400)console.info('Product API failure',req.method(),new URL(req.url()).pathname,r.status);cookie=r.headers.get('set-cookie')?.split(';')[0]??cookie;
  await route.fulfill({status:r.status,headers:{'Content-Type':'application/json','X-NAVI-AI-Mode':r.headers.get('X-NAVI-AI-Mode')},body:await r.text()});
 });
 try{
  await page.setViewportSize({width,height:900});await page.goto('/embed');
  await expect(page.getByRole('button',{name:'資料與隱私',exact:true})).toBeVisible();
  await page.locator('#story-input').fill('我搬家了，要變更保單地址');await page.locator('#story-input').press('Enter');
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();expect(calls).toBe(0);
  await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'確認並繼續'}).click();
  await page.locator('#story-input').fill('我搬家了，要變更保單地址');await page.locator('#story-input').press('Enter');
  await expect(page.getByRole('button',{name:'開啟工作區'})).toBeVisible();expect(calls).toBe(1);
  await page.getByRole('button',{name:'開啟工作區'}).click();await expect(page.getByRole('heading',{name:'地址變更',exact:true,level:1})).toBeVisible();
  await page.getByRole('checkbox').nth(0).click();await expect(page.getByRole('checkbox').nth(0)).toBeChecked();
  await page.reload();await expect(page.getByRole('heading',{name:'地址變更',exact:true,level:1})).toBeVisible();await expect(page.getByRole('checkbox').nth(0)).toBeChecked();expect(calls).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'資料與隱私',exact:true}).click();await expect(dialog.getByRole('button',{name:'地址變更 · 資料準備'})).toBeVisible();
  await dialog.getByLabel('電子郵件或測試帳號').fill('synthetic_browser');await dialog.getByLabel('密碼（至少 12 個字元）').fill('SYNTHETIC-password-123');await dialog.getByRole('button',{name:'建立帳號並保存'}).click();await expect(dialog.getByRole('heading',{name:'已登入',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'刪除我的資料',exact:true}).click();await dialog.getByRole('button',{name:'確認刪除全部資料'}).click();await expect(dialog).toHaveCount(0);
 }finally{await page.unrouteAll({behavior:'wait'}).catch(()=>{});server.closeAllConnections();await new Promise(r=>server.close(r));await config.store.db.dropDatabase();await app.locals.close();rmSync(dir,{recursive:true,force:true});}
});
test('email recovery and a private handoff draft recover in the browser; only fixture provider work',async({page})=>{
 const dir=mkdtempSync(join(tmpdir(),'navi-browser-auth-')),origin='https://app.navitw.com',outbox=[];let cookie='',generations=0;
 const c=loadConfig({NAVI_PRODUCT_MODE:'true',MONGODB_URI:TEST_URI,MONGODB_DATABASE:'navi_test_auth_'+randomBytes(10).toString('hex'),NAVI_PRIVATE_STATE_PATH:dir,NAVI_DATA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),NAVI_AUTH_REQUIRED:'true',NAVI_AUTH_REQUIRE_VERIFIED_EMAIL:'true',AI_MODE:'live',GEMINI_API_KEY:'mock-only',GEMINI_FREE_TIER_CONFIRMED:'true',AI_SYNTHETIC_TEST_ONLY:'true',WEB_ORIGINS:origin});
 c.sendMail=async message=>{outbox.push(message);return {accepted:[message.to]};};c.store=await new MongoStore({uri:c.mongoUri,database:c.mongoDatabase,key:c.dataEncryptionKey}).connect();
 const app=createApp(c,{mode:'live',understandIntent:async message=>{generations++;return createDemoProvider().understandIntent(message);}}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 async function direct(path,body){const r=await fetch(base+'/api'+path,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});cookie=r.headers.get('set-cookie')?.split(';')[0]??cookie;return {status:r.status,data:await r.json()};}
 await page.route('**/api/**',async route=>{const q=route.request(),r=await fetch(base+new URL(q.url()).pathname,{method:q.method(),headers:{Origin:origin,Cookie:cookie,...(q.headers()['content-type']?{'Content-Type':q.headers()['content-type']}: {})},...(q.postDataBuffer()?{body:q.postDataBuffer()}: {})});cookie=r.headers.get('set-cookie')?.split(';')[0]??cookie;await route.fulfill({status:r.status,headers:{'Content-Type':'application/json','X-NAVI-AI-Mode':r.headers.get('X-NAVI-AI-Mode')},body:await r.text()});});
 try{
  expect((await direct('/auth/register',{email:'browser@example.invalid',password:'SYNTHETIC-original-123'})).status).toBe(201);
  const verify=outbox[0].text.match(/#token=([a-f0-9]{64})/)[1];await page.goto('/?auth=verify#token='+verify);const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'確認驗證',exact:true}).click();await expect(dialog.getByText('信箱驗證完成，請登入繼續。')).toBeVisible();
  await direct('/auth/logout',{});await direct('/auth/password/forgot',{email:'browser@example.invalid'});const token=outbox[1].text.match(/#token=([a-f0-9]{64})/)[1];await page.goto('/?auth=reset#token='+token);await dialog.getByLabel('新密碼（至少 12 個字元）').fill('SYNTHETIC-new-password-123');await dialog.getByRole('button',{name:'確認重設密碼'}).click();await expect(dialog.getByText('密碼已重設，原有登入已失效，請重新登入。')).toBeVisible();
  await dialog.getByRole('button',{name:'關閉',exact:true}).click();await page.getByRole('dialog',{name:'資料與隱私'}).getByLabel('電子郵件或測試帳號').fill('browser@example.invalid');await page.getByRole('dialog').getByLabel('密碼（至少 12 個字元）').fill('SYNTHETIC-new-password-123');await page.getByRole('dialog').getByRole('button',{name:'登入',exact:true}).click();await expect(page.getByRole('dialog').getByRole('heading',{name:'已登入',exact:true})).toBeVisible();expect(generations).toBe(0);
  await page.getByRole('dialog').getByRole('button',{name:'關閉',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await direct('/session/consent',{syntheticOnly:true,disclosureVersion:'gemini-unpaid-2026-10'});const j=(await direct('/journeys',{message:'我在合成醫院住院五天'})).data;
  await page.evaluate(id=>localStorage.setItem('navi.journey',JSON.stringify({v:3,current:id,journeys:[{journeyId:id,source:'gemini',handoffRequested:false}]})),j.id);await page.goto('/#workspace');await page.reload();
  await page.getByRole('button',{name:'需要協助？轉由專員接續'}).click();await page.getByRole('dialog').getByLabel('想請專員確認的事項').fill('請確認合成文件清單');await page.getByRole('button',{name:'儲存未送出草稿'}).click();await expect(page.getByText('草稿已保存，尚未傳送給客服或保險公司。')).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:'關閉',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await page.reload();await page.getByRole('button',{name:'需要協助？轉由專員接續'}).click();await expect(page.getByRole('dialog').getByLabel('想請專員確認的事項')).toHaveValue('請確認合成文件清單');expect(generations).toBe(1);
 }finally{await page.unrouteAll({behavior:'wait'}).catch(()=>{});server.closeAllConnections();await new Promise(r=>server.close(r));await c.store.db.dropDatabase();await app.locals.close();rmSync(dir,{recursive:true,force:true});}
});

for(const failed of [false,true])test(`late anonymous profile ${failed?'error':'success'} cannot overwrite the account after login`,async({page})=>{
 const origin='https://app.navitw.com',dir=mkdtempSync(join(tmpdir(),'navi-dialog-race-'));
 const c=loadConfig({NAVI_PRODUCT_MODE:'true',MONGODB_URI:TEST_URI,MONGODB_DATABASE:'navi_dialog_'+randomBytes(10).toString('hex'),NAVI_PRIVATE_STATE_PATH:dir,NAVI_DATA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),AI_MODE:'demo',AI_PUBLIC_SYNTHETIC:'true',AI_SYNTHETIC_TEST_ONLY:'true',WEB_ORIGINS:origin});
 c.store=await new MongoStore({uri:c.mongoUri,database:c.mongoDatabase,key:c.dataEncryptionKey}).connect();const app=createApp(c,createDemoProvider()),http=app.listen(0,'127.0.0.1');await new Promise(r=>http.once('listening',r));const base=`http://127.0.0.1:${http.address().port}`;let cookie='',release,held=false;
 const credentials={username:'synthetic_dialog_race',password:'SYNTHETIC-password-123'};
 await fetch(base+'/api/auth/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(credentials)});
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;const r=await fetch(base+path,{method:req.method(),headers:{Origin:origin,Cookie:cookie,...(req.headers()['content-type']?{'Content-Type':req.headers()['content-type']}:{})},...(req.postDataBuffer()?{body:req.postDataBuffer()}:{})});cookie=r.headers.get('set-cookie')?.split(';')[0]??cookie;const body=await r.text();if(path==='/api/history'&&!held){held=true;await new Promise(resolve=>release=resolve);if(failed){await route.fulfill({status:503,headers:{'Content-Type':'application/json','X-NAVI-AI-Mode':'demo'},body:JSON.stringify({success:false,error:{code:'STORAGE_UNAVAILABLE',message:'合成故障測試',retryable:true}})});return;}}await route.fulfill({status:r.status,headers:{'Content-Type':'application/json','X-NAVI-AI-Mode':r.headers.get('x-navi-ai-mode')},body}).catch(()=>{});});
 try{await page.goto('/embed');await page.getByRole('button',{name:'資料與隱私',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('電子郵件或測試帳號').fill(credentials.username);await dialog.getByLabel('密碼（至少 12 個字元）').fill(credentials.password);await dialog.getByRole('button',{name:'登入',exact:true}).click();await expect(dialog.getByRole('heading',{name:'已登入',exact:true})).toBeVisible();release?.();await page.waitForTimeout(250);await expect(dialog.getByRole('heading',{name:'已登入',exact:true})).toBeVisible();await expect(dialog.getByRole('alert')).toHaveCount(0);}
 finally{release?.();await page.unrouteAll({behavior:'wait'}).catch(()=>{});http.closeAllConnections();await new Promise(r=>http.close(r));await c.store.db.dropDatabase();await app.locals.close();rmSync(dir,{recursive:true,force:true});}
});
