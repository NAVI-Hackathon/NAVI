import {useState,useEffect,useRef,useCallback} from 'react';
import Modal from './Modal.jsx';
import { errorNotice } from '../../domain/productErrors.js';
// 資料與隱私 for the persistent service: consent, the shown journey's data (children), account and history.
// Account actions appear only when the server can complete them (GET /session).
export default function ProductDataDialog({service,onClose,onJourney,onDeleted,consentOnly=false,onConsent,children}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[agreed,setAgreed]=useState(false),[deleting,setDeleting]=useState(false);
  const [username,setUsername]=useState(''),[password,setPassword]=useState('');
  const requestVersion=useRef(0);
  const refresh=useCallback(async()=>{const version=++requestVersion.current;const next=await service.productInfo();if(version===requestVersion.current)setData(next);},[service]);
  useEffect(()=>{const pending=refresh(),version=requestVersion.current;pending.catch(e=>{if(version===requestVersion.current)setError(errorNotice(e,'目前無法讀取資料，請稍後再試。'));});return()=>{requestVersion.current++;};},[refresh]);
  async function run(fn){requestVersion.current++;setError('');setBusy(true);try{await fn();}catch(e){setError(errorNotice(e,'目前無法完成操作，請稍後再試。'));}finally{setBusy(false);}}
  return <Modal title={consentOnly?'資料處理說明':'資料與隱私'} onClose={onClose}>
    <p className="modal-lead">AI 會將你提供的內容交由 Google Gemini 處理。免費服務目前僅接受合成資料，請勿輸入真實病歷、姓名或銀行資料。</p>
    {(consentOnly||!children)&&<p className="modal-footnote">{data?.session ? <>原始檔只在處理期間暫存；旅程與對話自最後異動起加密保存最長 {data.session.retentionDays} 天；帳號最多保存 10 年，可自行刪除。關閉瀏覽器後可在同一工作階段恢復；登入後可於其他裝置存取。備份依約 7 天的例行輪替清理；線上刪除不會立即消除既有備份。</> : '正在讀取資料保存期限…'}</p>}
    {!consentOnly&&children}
    <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">查看 Google 資料處理條款</a>
    {!data?.session?.consentAccepted&&<><label className="check-row"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>我已閱讀說明，這次僅使用合成資料。</label><button className="button button-primary" disabled={!agreed||busy} onClick={()=>run(async()=>{await service.acceptConsent();await refresh();onConsent?.();if(consentOnly)onClose();})}>確認並繼續</button></>}
    {!consentOnly&&<>
      <section className="review-section"><h3>{data?.session?.authenticated?'已登入':'保存至帳號'}</h3>
      {data?.session?.authenticated?<button className="button button-secondary" disabled={busy} onClick={()=>run(async()=>{await service.logout();onDeleted();onClose();})}>登出</button>:<form onSubmit={e=>{e.preventDefault();run(async()=>{await service.login(username,password);setPassword('');onDeleted();await refresh();});}}>
        <label className="field-label" htmlFor="product-user">電子郵件或測試帳號</label><input id="product-user" autoComplete="username" value={username} minLength={3} maxLength={254} required onChange={e=>setUsername(e.target.value)}/>
        <label className="field-label" htmlFor="product-password">密碼（至少 12 個字元）</label><input id="product-password" type="password" autoComplete="current-password" value={password} minLength={12} maxLength={128} required onChange={e=>setPassword(e.target.value)}/>
        {data?.session?.registrationAvailable===false&&<p className="modal-footnote">公開帳號註冊尚未開放；測試帳號可登入，既有合成工作階段可繼續使用。</p>}
        <div className="modal-actions"><button className="button button-secondary" disabled={busy} type="submit">登入</button>{data?.session?.registrationAvailable===true&&<button className="button button-secondary" type="button" disabled={busy||username.length<3||password.length<12} onClick={()=>run(async()=>{await service.register(username,password);setPassword('');onDeleted();await refresh();})}>建立帳號並保存</button>}</div>
      </form>}</section>
      <section className="review-section"><h3>已保存的旅程</h3>{data?.history?.journeys.length?data.history.journeys.map(j=><button className="button button-ghost" key={j.id} disabled={busy} onClick={()=>run(async()=>{onJourney(await service.openJourney(j.id));onClose();})}>{j.title} · {j.serviceType==='hospitalization_claim'?j.readiness+'%':'資料準備'}</button>):<p>目前沒有已保存的旅程。</p>}{data?.history?.nextCursor&&<button className="button button-ghost" disabled={busy} onClick={()=>run(async()=>{const page=await service.historyPage(data.history.nextCursor);setData(current=>({...current,history:{...current.history,journeys:[...current.history.journeys,...page.items],nextCursor:page.nextCursor}}));})}>載入更多旅程</button>}</section>
      <section className="review-section"><h3>待處理任務</h3>{data?.tasks?.filter(t=>t.status==='pending').map(t=><button className="button button-ghost" key={t.taskId} disabled={busy} onClick={()=>run(async()=>{onJourney(await service.continueTask(t.taskId));onClose();})}>{t.summary}</button>)}{!data?.tasks?.some(t=>t.status==='pending')&&<p>目前沒有待處理任務。</p>}</section>
      {!data?.session?.authenticated&&data?.session?.emailDeliveryConfigured===true&&username.includes('@')&&<div className="modal-actions"><button className="button button-ghost" disabled={busy} onClick={()=>run(async()=>{await service.requestPasswordReset(username);setError('若帳號存在，將寄出密碼重設連結。');})}>忘記密碼</button><button className="button button-ghost" disabled={busy} onClick={()=>run(async()=>{await service.requestVerification(username);setError('若帳號存在，將寄出驗證連結。');})}>重新寄送驗證信</button></div>}
      <section className="review-section"><h3>資料管理</h3><button className="button button-secondary" disabled={busy} onClick={()=>run(()=>service.exportData())}>下載我的資料</button>
        {!deleting?<button className="button button-ghost" disabled={busy} onClick={()=>setDeleting(true)}>刪除我的資料</button>:<div role="alert"><p>將刪除目前使用者的旅程、對話與帳號，無法復原。</p><button className="button button-secondary" disabled={busy} onClick={()=>setDeleting(false)}>保留資料</button><button className="button button-primary" disabled={busy} onClick={()=>run(async()=>{await service.deleteData();onDeleted();onClose();})}>確認刪除全部資料</button></div>}
      </section>
    </>}
    {busy&&<p role="status">正在處理…</p>}{error&&<p className="doc-failed" role="alert">{error}</p>}
  </Modal>;
}
