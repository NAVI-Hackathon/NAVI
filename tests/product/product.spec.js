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
  await expect(page.getByRole('button',{name:'我的資料與歷程',exact:true})).toBeVisible();
  await page.locator('#story-input').fill('我搬家了，要變更保單地址');await page.locator('#story-input').press('Enter');
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();expect(calls).toBe(0);
  await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'確認並繼續'}).click();
  await page.locator('#story-input').fill('我搬家了，要變更保單地址');await page.locator('#story-input').press('Enter');
  await expect(page.getByRole('button',{name:'開啟工作區'})).toBeVisible();expect(calls).toBe(1);
  await page.getByRole('button',{name:'開啟工作區'}).click();await expect(page.getByRole('heading',{name:'地址變更',exact:true,level:1})).toBeVisible();
  await page.getByRole('checkbox').nth(0).click();await expect(page.getByRole('checkbox').nth(0)).toBeChecked();
  await page.reload();await expect(page.getByRole('heading',{name:'地址變更',exact:true,level:1})).toBeVisible();await expect(page.getByRole('checkbox').nth(0)).toBeChecked();expect(calls).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'我的資料與歷程',exact:true}).click();await expect(dialog.getByRole('button',{name:'地址變更 · 資料準備'})).toBeVisible();
  await dialog.getByLabel('電子郵件或測試帳號').fill('synthetic_browser');await dialog.getByLabel('密碼（至少 12 個字元）').fill('SYNTHETIC-password-123');await dialog.getByRole('button',{name:'建立帳號並保存'}).click();await expect(dialog.getByRole('heading',{name:'已登入',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'刪除我的資料',exact:true}).click();await dialog.getByRole('button',{name:'確認刪除全部資料'}).click();await expect(dialog).toHaveCount(0);
 }finally{await page.unrouteAll({behavior:'wait'});server.closeAllConnections();await new Promise(r=>server.close(r));await config.store.db.dropDatabase();await app.locals.close();rmSync(dir,{recursive:true,force:true});}
});
