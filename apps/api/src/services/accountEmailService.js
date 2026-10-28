import nodemailer from 'nodemailer';
import {randomBytes,createHash,scrypt} from 'node:crypto';
import {promisify} from 'node:util';
import {ApiError} from '../middleware/errorHandler.js';
const digest=v=>createHash('sha256').update(v).digest('hex'),derive=promisify(scrypt);
export function createAccountEmailService(config,sendMail){
 const store=config.store;
 const configured=Boolean(sendMail||config.smtpHost&&config.smtpUser&&config.smtpPassword&&config.mailFrom&&config.publicAppOrigin);
 const transport=sendMail?null:configured?nodemailer.createTransport({host:config.smtpHost,port:config.smtpPort,secure:config.smtpPort===465,requireTLS:true,auth:{user:config.smtpUser,pass:config.smtpPassword},connectionTimeout:5000,greetingTimeout:5000,socketTimeout:10000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true}}):null;
 const requireMail=()=>{if(!configured)throw new ApiError('MAIL_UNAVAILABLE','驗證與密碼恢復郵件尚未設定，暫不開放完整帳號註冊。',503,true);};
 async function request(email,purpose){requireMail();const key=digest(email.toLowerCase()),row=await store.get('accounts',key);if(!row?.value.email)return {accepted:true};
  const token=randomBytes(32).toString('hex'),id=digest(token);await store.put('auth_tokens',id,{accountId:key,purpose},{owner:row.owner,ttlMs:30*60000});
  const link=new URL('/',config.publicAppOrigin);link.searchParams.set('auth',purpose);link.hash='token='+token;
  try{const message={from:config.mailFrom,to:row.value.email,subject:purpose==='verify'?'NAVI 信箱驗證':'NAVI 密碼重設',text:`請在 30 分鐘內開啟下列連結${purpose==='verify'?'完成信箱驗證':'重設密碼'}：\n${link}\n若非本人操作，請忽略本信。`};const result=sendMail?await sendMail(message):await transport.sendMail(message);if(!result?.accepted?.includes(row.value.email))throw Error('delivery');await store.audit({code:'ACCOUNT_EMAIL_ACCEPTED',operation:purpose,status:'accepted'},row.owner);}
  catch{await store.delete('auth_tokens',id);await store.audit({code:'ACCOUNT_EMAIL_FAILED',operation:purpose,status:'failed'},row.owner);throw new ApiError('MAIL_UNAVAILABLE','郵件目前無法寄出，請稍後重新要求驗證或密碼重設。',503,true);}return {accepted:true};
 }
 async function consume(token,purpose,password){const id=digest(token);let salt,hash;if(password){salt=randomBytes(16).toString('hex');hash=(await derive(password,salt,64,{N:16384,r:8,p:1})).toString('hex');}
  return store.transaction(async()=>{const saved=await store.get('auth_tokens',id);if(!saved||saved.value.purpose!==purpose)throw new ApiError('AUTH_TOKEN_INVALID','連結已失效或已使用，請重新申請。',400,false);const account=await store.get('accounts',saved.value.accountId);if(!account)throw new ApiError('AUTH_TOKEN_INVALID','連結已失效，請重新申請。',400,false);
   await store.put('accounts',saved.value.accountId,{...account.value,...(purpose==='verify'?{emailVerified:true}:{salt,hash})},{owner:account.owner,expectedRevision:account.revision,ttlMs:3650*86400000});for(const row of await store.list('auth_tokens',account.owner))await store.delete('auth_tokens',row.id);if(purpose==='reset')for(const row of await store.list('sessions',account.owner))await store.delete('sessions',row.id);await store.audit({code:purpose==='verify'?'EMAIL_VERIFIED':'PASSWORD_RESET',status:'confirmed'},account.owner);return {success:true};
  });
 }
 return {available:configured,requireMail,requestVerification:email=>request(email,'verify'),requestReset:email=>request(email,'reset'),verify:token=>consume(token,'verify'),reset:(token,password)=>consume(token,'reset',password)};
}
