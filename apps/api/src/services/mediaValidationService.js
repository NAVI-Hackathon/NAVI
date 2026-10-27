import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ApiError} from '../middleware/errorHandler.js';
const run=promisify(execFile);
export async function validateMedia(upload,config,signal,runPdf=run){
 if(!config.productMode||!config.production)return;
 const options={timeout:4000,maxBuffer:1024*1024,signal};
 let folder;
 try{
  if(upload.mimeType==='application/pdf'){
   const pdf=args=>runPdf('/usr/bin/prlimit',['--as=268435456','--cpu=3','--','/usr/bin/qpdf',...args],options);
   const directory=join(config.databasePath,'uploads');await mkdir(directory,{recursive:true,mode:0o700});folder=await mkdtemp(join(directory,'doc-'));
   const path=join(folder,'upload.pdf');await writeFile(path,upload.bytes,{mode:0o600,flag:'wx'});
   await pdf(['--check',path]);
   const {stdout:pages}=await pdf(['--show-npages',path]);
   if(!/^\d+\s*$/.test(pages)||Number(pages)<1||Number(pages)>20)throw Error('pages');
   const {stdout}=await pdf(['--json',path]);const data=JSON.parse(stdout);
   if(data.encrypt?.encrypted||Object.keys(data.attachments??{}).length||/"\/(?:JavaScript|JS|Launch|EmbeddedFiles|OpenAction|AA)"/.test(stdout))throw Error('active_pdf');
  }else await new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/python3',[fileURLToPath(new URL('./decodeImage.py',import.meta.url)),upload.mimeType],{signal,timeout:4000,stdio:['pipe','ignore','ignore']});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('decode')));child.stdin.on('error',()=>{});child.stdin.end(upload.bytes);
  });
 }catch{
  if(signal?.aborted)throw new ApiError('REQUEST_CANCELLED','上傳已取消。',499,false);
  throw new ApiError('DOCUMENT_INVALID','文件無法安全解析。請提供未加密、沒有嵌入程式、20 頁以內的 PDF，或清晰的 PNG、JPG、WebP 靜態圖片。',422,true);
 }finally{if(folder)await rm(folder,{recursive:true,force:true});}
}
