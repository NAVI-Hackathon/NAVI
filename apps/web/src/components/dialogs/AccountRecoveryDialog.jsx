import {useState} from 'react';
import Modal from './Modal.jsx';
export default function AccountRecoveryDialog({service,action,token,onClose}){
 const [password,setPassword]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[done,setDone]=useState(false);
 async function submit(e){e.preventDefault();setBusy(true);setMessage('');try{if(action==='verify')await service.verifyEmail(token);else await service.resetPassword(token,password);setPassword('');setDone(true);setMessage(action==='verify'?'信箱驗證完成，請登入繼續。':'密碼已重設，原有登入已失效，請重新登入。');}catch(e){setMessage(e.message);}finally{setBusy(false);}}
 return <Modal title={action==='verify'?'驗證電子郵件':'重設密碼'} onClose={onClose}><p className="modal-lead">連結只能使用一次，30 分鐘後失效。</p>{!done&&<form onSubmit={submit}>{action==='reset'&&<><label className="field-label" htmlFor="recovery-password">新密碼（至少 12 個字元）</label><input id="recovery-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)}/></>}<button className="button button-primary" disabled={busy} type="submit">{busy?'正在處理…':action==='verify'?'確認驗證':'確認重設密碼'}</button></form>}{message&&<p role={done?'status':'alert'}>{message}</p>}</Modal>;
}
