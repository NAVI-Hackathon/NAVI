import { useMemo, useState } from 'react';
import Icon from '../Icon.jsx';
import Modal from './Modal.jsx';
import AnswerCard from '../knowledge/AnswerCard.jsx';
import { searchKnowledge } from '../../../../../shared/knowledge/index.js';
import { journeySummaryText, summaryFileName } from '../../domain/journeySummary.js';
import { copyText, downloadText } from '../../services/textExport.js';

/**
 * 找服務: type a few words, see the official-site entries that match (local snapshot, no AI call), each
 * with its source and 帶我去. Nothing found: the hotline, or say it in the chat instead.
 */
export function SearchDialog({ onClose, onNavigate, onAsk }) {
  const [query, setQuery] = useState('');
  const result = useMemo(() => (query.trim() ? searchKnowledge(query, { limit: 5 }) : null), [query]);
  const go = onNavigate ? destination => { onClose(); onNavigate(destination); } : null;
  return (
    <Modal title="找服務" onClose={onClose}>
      <p className="modal-lead">輸入幾個字，例如「地址」「住院」「申請書」，直接找官網上的服務、表單與常見問題。</p>
      <label className="search-field">
        <Icon name="search" size={16} />
        <span className="visually-hidden">搜尋服務</span>
        <input type="search" data-autofocus value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋服務、表單或問題" maxLength={60} autoComplete="off" />
      </label>
      <div className="search-results" aria-live="polite">
        {result?.status === 'answered' && (
          <>
            <p className="search-count">找到 {result.results.length} 筆官網資料</p>
            {result.results.map(entry => <AnswerCard key={entry.id} entry={entry} onNavigate={go} compact highlights={result.highlights[entry.id]} headingLevel={3} />)}
          </>
        )}
        {result?.status === 'out_of_scope' && (
          <p className="search-empty">NAVI 只根據官網公開資料說明，不提供投保建議，也無法判斷能否理賠或理賠金額。請洽免付費服務專線 {result.hotline}。</p>
        )}
        {result?.status === 'not_found' && (
          <div className="search-empty">
            <p>官網資料中沒有找到「{query.trim()}」。可以換個說法，或洽免付費服務專線 {result.hotline}。</p>
            {onAsk && <button type="button" className="button button-secondary button-small" onClick={() => { onClose(); onAsk(query.trim()); }}>改在聊天室描述<Icon name="arrow" size={14} /></button>}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** 辦理摘要: the journey's state as plain text, to copy or save. Built in the browser; nothing is sent. */
export function SummaryDialog({ snapshot, onClose }) {
  const text = useMemo(() => journeySummaryText(snapshot), [snapshot]);
  const [copied, setCopied] = useState(null);
  const download = () => downloadText(summaryFileName(), text);
  async function copy() {
    const ok = await copyText(text);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(null), 1800);
  }
  return (
    <Modal title="辦理摘要" onClose={onClose}>
      <p className="modal-lead">把這件事目前的狀態帶走，之後準備或洽詢時可以對照。</p>
      <p className="handoff-redacted"><Icon name="lock" size={13} />只列項目與狀態；不含你的描述，也不含文件上的姓名、日期或帳號。</p>
      <pre className="summary-text" tabIndex={0} aria-label="摘要內容">{text}</pre>
      {copied === false && <p className="summary-note" role="alert">瀏覽器不允許複製，請改用「下載摘要」。</p>}
      <div className="modal-actions">
        <p className="modal-footnote"><Icon name="shield" size={14} />摘要只在你的裝置上產生，不會送出。</p>
        <button type="button" className="button button-secondary" onClick={download}><Icon name="download" size={16} />下載摘要</button>
        <button type="button" className="button button-primary" onClick={copy}>{copied ? '已複製' : '複製摘要'}<Icon name={copied ? 'check' : 'document'} size={16} /></button>
      </div>
    </Modal>
  );
}

/** Inline two-step button: the first press asks, the second does it (or 取消). */
function ConfirmAction({ label, confirmLabel, question, disabled, onConfirm }) {
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  if (!asking) return <button type="button" className="button button-secondary button-small" disabled={disabled} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <div className="privacy-confirm" role="group" aria-label={question}>
      <p>{question}</p>
      <button type="button" className="button button-ghost button-small" disabled={working} onClick={() => setAsking(false)}>取消</button>
      <button type="button" className="button button-danger button-small" disabled={working}
        onClick={async () => { setWorking(true); try { await onConfirm(); } finally { setWorking(false); setAsking(false); } }}>
        {working ? '處理中…' : confirmLabel}
      </button>
    </div>
  );
}

/**
 * 資料與隱私: what is kept where and for how long, and what the user can remove now. Every action here
 * does what it says: files and information are deleted on the server through its own endpoints; a
 * journey can only be forgotten by this browser until the server offers deleting a whole journey.
 */
export function PrivacyDialog({ snapshot, formal, onRemoveData, onForget, onClose }) {
  const journey = snapshot?.journey;
  const stored = journey ? journey.documents.length + (journey.manualDocumentInformation?.length ?? 0) : 0;
  return (
    <Modal title="資料與隱私" onClose={onClose}>
      <dl className="privacy-facts">
        {formal ? (
          <>
            <dt>這個瀏覽器</dt><dd>只記住你的服務旅程編號（關閉分頁後清除），不保存文件、描述或帳號資訊。</dd>
            <dt>NAVI 服務</dt><dd>不留存你的原始描述，只保存 NAVI 理解出的需求重點（例如醫院、住院日期）；文件由 AI 辨識後只保留辨識出的欄位，不保存檔案本身。</dd>
            <dt>保留多久</dt><dd>案件 1 小時後自動失效。</dd>
          </>
        ) : (
          <>
            <dt>示範模式</dt><dd>所有內容只在這個分頁中處理，使用示範資料；你的檔案不會被讀取或上傳。</dd>
            <dt>保留多久</dt><dd>關閉分頁後清除。</dd>
          </>
        )}
      </dl>
      <p className="privacy-warning"><Icon name="alert" size={13} />這是原型服務，請只使用合成範例，勿輸入或上傳真實病歷、身分證或銀行資料。</p>

      {journey && (
        <section className="privacy-actions" aria-label={`「${journey.title}」的資料`}>
          <h3>「{journey.title}」的資料</h3>
          <div className="privacy-action">
            <p>{stored ? `已保存 ${stored} 份文件或資訊。移除後準備完成度會跟著更新。` : '這件事目前沒有已上傳的文件或資訊。'}</p>
            <ConfirmAction label="移除已上傳的文件與資訊" confirmLabel="確定移除" disabled={!stored}
              question={formal ? '要從 NAVI 服務刪除這件事的所有文件欄位與資訊嗎？' : '要移除這件事的所有示範文件嗎？'} onConfirm={onRemoveData} />
          </div>
          <div className="privacy-action">
            <p>{formal ? '從這個瀏覽器移除這件事：之後無法再從這裡打開它；NAVI 服務上的案件會在 1 小時內自動失效（目前還不能立即刪除整件案件）。' : '移除這件事：示範資料會立即清除。'}</p>
            <ConfirmAction label={formal ? '從這個瀏覽器移除這件事' : '移除這件事'} confirmLabel="確定移除"
              question={`要移除「${journey.title}」嗎？其他事情不受影響。`} onConfirm={onForget} />
          </div>
        </section>
      )}
    </Modal>
  );
}
