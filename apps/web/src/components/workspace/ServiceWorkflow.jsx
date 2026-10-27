import {useEffect,useState} from 'react';
import {validateFile} from '../../domain/files.js';
export default function ServiceWorkflow({snapshot,service,onUpdate,onNavigate,onBack}){
 const j=snapshot.journey,[flow,setFlow]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{service.workflow(j.workflowId).then(setFlow).catch(e=>setError(e.message));},[service,j.workflowId]);
 async function check(index,value){setBusy(true);setError('');try{const all=j.requirements.map(r=>r.id);const checked=value?all.slice(0,index+1):all.slice(0,index);onUpdate(await service.checklist(checked));}catch(e){setError(e.message);if(e.code==='JOURNEY_STALE')onUpdate(await service.refresh());}finally{setBusy(false);}}
 async function documentAction(file){setError('');setBusy(true);try{if(file){const invalid=validateFile(file);if(invalid)throw Error(invalid);onUpdate(await service.uploadDocument('diagnosis_certificate',{file}));}else onUpdate(await service.removeDocument('diagnosis_certificate'));}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <main id="main-content" className="product-panel"><button type="button" className="button button-ghost" onClick={onBack}>回到對話</button><h1>{j.title}</h1><p>{j.disclaimer}</p>
   <p role="status">已確認 {j.requirements.filter(r=>r.status==='verified').length}／{j.requirements.length} 項 · {j.nextAction.title}</p>
   <section className="review-section"><h2>資料準備清單</h2>{j.requirements.map((r,i)=><label key={r.id} className="check-row"><input type="checkbox" checked={r.status==='verified'} disabled={busy} onChange={e=>check(i,e.target.checked)}/><span>{r.name}</span></label>)}</section>
   {j.workflowId==='outpatient_claim'&&<section className="review-section"><h2>診斷文件（可選）</h2><p>僅使用合成 PDF、JPG、PNG 或 WebP。欄位不足會保留待確認，不能用來證明理賠資格。</p><label className="field-label" htmlFor="outpatient-file">選擇合成診斷文件</label><input id="outpatient-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)documentAction(file);e.target.value='';}}/>{j.documents.map(d=><div key={d.id}><p>{d.status==='verified'?'欄位檢查通過，尚未驗證文件真偽':'文件欄位待確認'} · {d.isMock?'示範資料':'AI 內容抽取'}</p>{d.missingFields?.length>0&&<p>部分欄位缺漏，請確認來源要求或由專員協助。</p>}<button className="button button-secondary" disabled={busy} onClick={()=>documentAction(null)}>移除文件</button></div>)}</section>}
   {flow&&<section className="review-section"><h2>來源中的辦理說明</h2><ul>{flow.checklist.map((line,i)=><li key={i}>{line}</li>)}</ul></section>}
   <section className="review-section"><h2>資料來源</h2>{j.sources.map(s=><p key={s.id}><a href={s.sourceUrl??s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> · 擷取 {s.retrievedAt}</p>)}</section>
   <button type="button" className="button button-primary" disabled={!j.nextAction.destination} onClick={()=>onNavigate(j.nextAction.destination)}>帶我去服務說明</button>
   {error&&<p role="alert">{error}</p>}
 </main>;
}
