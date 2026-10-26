import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import Icon from '../Icon.jsx';
import Modal from './Modal.jsx';
import { basicJourneys } from '../../mocks/basicJourneys.js';
import { documentSpecs } from '../../mocks/hospitalClaim.js';
import { claimApplicationForm } from '../../content/cardifData.js';
import { maskAccount, stayDays, stayText } from '../../content/format.js';
import { CheckDraw } from '../../motion/primitives.jsx';
import { transition } from '../../motion/tokens.js';

const fieldsOf = (journey, type) => journey.documents.find(d => d.documentType === type)?.fields ?? {};
const formName = claimApplicationForm?.name ?? '保險金申請書';

export function ReviewDialog({ snapshot, onConfirm, onProceed, onClose }) {
  const { journey } = snapshot;
  const confirmed = journey.currentStage === 'READY_TO_PROCEED';
  const [dataChecked, setDataChecked] = useState(confirmed);
  const [formChecked, setFormChecked] = useState(confirmed);
  const cert = fieldsOf(journey, 'diagnosis_certificate');
  const bank = fieldsOf(journey, 'bank_passbook');
  const days = stayDays(cert.admissionDate, cert.dischargeDate);
  const rows = [
    ['病患姓名', cert.patientName],
    ['醫院', cert.hospitalName],
    ['住院期間', stayText(cert.admissionDate, cert.dischargeDate)],
    ['住院天數', days ? `${days} 天` : null],
    // The server never extracts clinical details; show the row only when a diagnosis is present.
    ...(cert.diagnosis ? [['診斷', cert.diagnosis]] : []),
    ['匯款帳戶', bank.bankName ? `${bank.bankName}　${maskAccount(bank.accountLast4)}（${bank.accountHolder}）` : null],
  ];
  return (
    <Modal title={confirmed ? '已確認的案件資料' : '確認案件資料'} onClose={onClose}>
      <p className="modal-lead">{confirmed ? '以下資料已確認完成。' : '請確認 NAVI 從文件辨識出的內容是否正確。'}</p>
      <dl className="review-list">
        {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '待確認'}</dd></div>)}
      </dl>
      <div className="review-docs">
        {journey.documents.map(d => (
          <span key={d.id} className="tag tag-quiet"><Icon name="check" size={12} />{documentSpecs[d.documentType]?.title}{d.entryMethod === 'manual' ? '（手動輸入）' : ''}</span>
        ))}
      </div>
      {!confirmed && (
        <>
          <label className="check-row">
            <input type="checkbox" checked={dataChecked} onChange={e => setDataChecked(e.target.checked)} />
            <span>我已確認以上資料正確（示範資料）。</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={formChecked} onChange={e => setFormChecked(e.target.checked)} />
            <span>我已下載並填妥{formName}。</span>
          </label>
        </>
      )}
      <div className="modal-actions">
        <p className="modal-footnote"><Icon name="shield" size={14} />確認資料不會送出理賠申請。</p>
        {confirmed
          ? <button type="button" className="button button-primary" onClick={onProceed}>前往服務入口<Icon name="arrow" size={16} /></button>
          : <button type="button" className="button button-primary" disabled={!dataChecked || !formChecked} onClick={onConfirm}>確認資料<Icon name="check" size={16} /></button>}
      </div>
    </Modal>
  );
}

export function ProceedDialog({ snapshot, onClose, onDone, onNavigate }) {
  const { journey } = snapshot;
  const channel = journey.claimContext?.channels.find(c => c.id === journey.nextAction.target);
  return (
    <Modal title="前往服務入口" onClose={onClose}>
      <div className="proceed">
        <motion.span className="proceed-mark" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1, transition: transition.enter }}>
          <CheckDraw size={26} strokeWidth={2.2} delay={0.1} />
        </motion.span>
        <h3>資料初步準備完成</h3>
        <p>NAVI 已整理好案件資料與 {journey.documents.length} 份文件，<strong>尚未送件</strong>。請透過下方建議管道向法國巴黎人壽提出申請，理賠服務會依保單條款審核。</p>
        <ul className="proceed-summary">
          <li><span>建議管道</span><strong>{channel?.name ?? '理賠服務'}</strong></li>
          <li><span>準備完成度</span><strong>{journey.readiness}%</strong></li>
        </ul>
        {channel && <ul className="proceed-notes">{channel.notes.map(note => <li key={note}>{note}</li>)}</ul>}
        <p className="modal-footnote"><Icon name="info" size={14} />本原型僅展示服務導引，不會連線正式平台或送出申請。</p>
        {channel && onNavigate && (
          <button type="button" className="button button-secondary full-width" onClick={() => { onNavigate(channel.destination); onDone(); }}>
            <Icon name="external" size={16} />{channel.destination.label}
          </button>
        )}
        <button type="button" className="button button-primary full-width" onClick={onDone}>完成導引<Icon name="check" size={16} /></button>
      </div>
    </Modal>
  );
}

function summaryText(summary) {
  return [
    'NAVI 交接摘要（使用者已確認；尚未傳送給客服或專員）',
    `需求：${summary.issue}`,
    `已取得：${summary.collected.join('、') || '尚未取得'}`,
    `尚待補齊：${summary.missing.join('、') || '無'}`,
    ...summary.concerns.map(concern => `需要確認：${concern}`),
    `需要專員協助的原因：${summary.reason}`,
    ...summary.sources.filter(source => source.url).map(source => `依據：${source.title}（擷取 ${source.retrievedAt}）${source.url}`),
    summary.disclaimer,
  ].join('\n');
}

function HandoffSkeleton() {
  return (
    <div className="handoff-skeleton" role="status" aria-label="正在整理交接摘要">
      <span className="shimmer w-40" /><span className="shimmer w-70" /><span className="shimmer w-55" /><span className="shimmer w-65" />
    </div>
  );
}

function HandoffSummaryCard({ summary }) {
  const sources = summary.sources.filter(source => source.url);
  return (
    <motion.div className="handoff-card" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: transition.enter }}>
      <section>
        <h3>需求</h3>
        <p className="handoff-issue">{summary.issue}</p>
      </section>
      <section className="handoff-split">
        <div>
          <h3>已取得 <span>{summary.collected.length}</span></h3>
          {summary.collected.length
            ? <ul className="handoff-chips">{summary.collected.map(name => <li key={name}><Icon name="check" size={11} strokeWidth={2.2} />{name}</li>)}</ul>
            : <p className="handoff-empty">尚未取得資料</p>}
        </div>
        <div>
          <h3>尚待補齊 <span>{summary.missing.length}</span></h3>
          {summary.missing.length
            ? <ul className="handoff-chips is-missing">{summary.missing.map(name => <li key={name}>{name}</li>)}</ul>
            : <p className="handoff-empty">必要資料都已備齊</p>}
        </div>
      </section>
      <section>
        <h3>需要專員協助的原因</h3>
        <p>{summary.reason}</p>
        {summary.concerns.length > 0 && (
          <ul className="handoff-issues">{summary.concerns.map(concern => <li key={concern}><Icon name="alert" size={13} />{concern}</li>)}</ul>
        )}
      </section>
      {sources.length > 0 && (
        <section>
          <h3>依據來源 <span>{sources.length}</span></h3>
          <ul className="handoff-sources">
            {sources.map(source => (
              <li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><span>擷取 {source.retrievedAt}</span></li>
            ))}
          </ul>
        </section>
      )}
    </motion.div>
  );
}

/**
 * Handoff with consent: the server builds a redacted preview bound to this journey version
 * (POST …/handoff/preview); the user reads it and confirms (POST …/handoff/confirm) to obtain the summary.
 * Nothing is sent to a specialist — the copy says 取得交接摘要, never 已轉交. /demo builds the same shapes locally.
 */
export function HandoffDialog({ snapshot, service, onConfirmed, onClose }) {
  const [phase, setPhase] = useState('loading'); // loading | preview | confirming | confirmed | error
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const confirmedOnce = useRef(snapshot.context.handoffRequested);

  useEffect(() => {
    const ctl = new AbortController();
    setPhase('loading'); setAgreed(false); setError('');
    service.handoffPreview({ signal: ctl.signal })
      .then(next => { setPreview(next); setPhase('preview'); })
      .catch(err => { if (!ctl.signal.aborted) { setError(err?.code && err.message ? err.message : '目前無法整理摘要，請稍後再試。'); setPhase('error'); } });
    return () => ctl.abort();
  }, [service, attempt]);

  async function confirm() {
    setPhase('confirming');
    try {
      const result = await service.confirmHandoff(preview.previewId);
      setPreview(current => ({ ...current, summary: result.summary }));
      setPhase('confirmed');
      onConfirmed();
    } catch (err) {
      // Stale (journey changed) or expired previews must be reviewed again before confirming.
      setError(err?.code && err.message ? err.message : '確認失敗，請重新查看摘要。');
      setPhase('error');
    }
  }

  const summary = preview?.summary;
  const text = summary ? summaryText(summary) : '';
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'NAVI-交接摘要.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { download(); }
  }

  const confirmed = phase === 'confirmed';
  return (
    <Modal title="轉由專員協助" onClose={onClose}>
      <div className="handoff-lead">
        <p className="modal-lead">NAVI 把你的情況整理成交接摘要。請先確認內容，專員接手時就不需要你重新說明。</p>
        <span className={`handoff-status ${confirmed ? 'is-ready' : ''}`}>{confirmed ? '已取得摘要・尚未送出' : '待你確認'}</span>
      </div>
      <p className="handoff-redacted"><Icon name="lock" size={13} />摘要只列項目名稱，已省略你的描述、姓名、醫院、日期與帳號。</p>

      {phase === 'loading' && <HandoffSkeleton />}
      {phase === 'error' && (
        <div className="doc-failed handoff-error" role="alert">
          <Icon name="alert" size={18} />
          <div>
            <strong>{error}</strong>
            <div className="doc-failed-actions">
              <button type="button" className="button button-secondary button-small" onClick={() => setAttempt(n => n + 1)}>重新整理摘要<Icon name="reset" size={15} /></button>
            </div>
          </div>
        </div>
      )}
      {summary && phase !== 'loading' && phase !== 'error' && <HandoffSummaryCard summary={summary} />}

      {confirmed ? (
        <motion.div className="success-note" role="status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: transition.enter }}>
          <CheckDraw size={16} strokeWidth={2.4} />
          <div><strong>已取得交接摘要</strong><p>{summary.disclaimer}</p></div>
        </motion.div>
      ) : (phase === 'preview' || phase === 'confirming') && (
        <label className="check-row">
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
          <span>我已確認摘要內容{confirmedOnce.current ? '（之前已取得過，這是最新版本）' : ''}，同意取得交接摘要。</span>
        </label>
      )}

      <div className="modal-actions">
        <p className="modal-footnote"><Icon name="shield" size={14} />示範原型不會聯繫專員、建立案件或送出申請。</p>
        {confirmed ? (
          <>
            <button type="button" className="button button-secondary" onClick={download}><Icon name="download" size={16} />下載摘要</button>
            <button type="button" className="button button-primary" onClick={copy}>{copied ? '已複製' : '複製摘要'}<Icon name={copied ? 'check' : 'document'} size={16} /></button>
          </>
        ) : (
          <button type="button" className="button button-primary" disabled={phase !== 'preview' || !agreed} onClick={confirm}>
            {phase === 'confirming' ? '確認中…' : '確認並取得摘要'}<Icon name="arrow" size={16} />
          </button>
        )}
      </div>
    </Modal>
  );
}

export function ServiceDialog({ snapshot, onHandoff, onClose }) {
  const basic = basicJourneys[snapshot.context.kind] ?? basicJourneys.unknown;
  return (
    <Modal title={basic.title} onClose={onClose}>
      <p className="modal-lead">{snapshot.journey.nextAction.description}</p>
      <ol className="numbered-steps">{basic.steps.map(step => <li key={step}>{step}</li>)}</ol>
      <p className="modal-footnote"><Icon name="info" size={14} />這項服務目前提供辦理導引；完整服務旅程將於後續版本開放。</p>
      <div className="modal-actions">
        <button type="button" className="button button-secondary" onClick={onClose}>我知道了</button>
        <button type="button" className="button button-primary" onClick={onHandoff}>轉由專員協助<Icon name="arrow" size={16} /></button>
      </div>
    </Modal>
  );
}
