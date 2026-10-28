import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Icon from '../Icon.jsx';
import ManualEntryForm, { unverifiedForms } from './ManualEntryForm.jsx';
import { validateFile } from '../../domain/files.js';
import { documentRecovery, unrecognizedFields } from '../../domain/documentRecovery.js';
import { documentSpecs } from '../../mocks/hospitalClaim.js';
import { maskAccount, stayDays, stayText } from '../../content/format.js';
import { CheckDraw, useCountUp } from '../../motion/primitives.jsx';
import { fadeUp, spring, staggerChildren, transition } from '../../motion/tokens.js';

function DaysValue({ days }) {
  const shown = useCountUp(days ?? 0, { from: 0 });
  return <>{days === null ? '待確認' : `${Math.round(shown)} 天`}</>;
}

// Fields the recognition is asked for, per document type; a missing one is shown as 未辨識.
const FIELD_NAMES = {
  diagnosis_certificate: ['patientName', 'hospitalName', 'admissionDate', 'dischargeDate'],
  bank_passbook: ['accountHolder', 'bankName', 'accountLast4'],
};
const Unrecognized = () => <span className="doc-unrecognized">未辨識</span>;

function fieldRows(type, fields) {
  if (type === 'diagnosis_certificate') {
    return [
      ['文件類型', '診斷證明書'],
      ['病患姓名', fields.patientName],
      ['醫院', fields.hospitalName],
      // The server never extracts clinical details (diagnosis is null); only show it when present.
      ...(fields.diagnosis ? [['診斷', fields.diagnosis]] : []),
      ['住院期間', stayText(fields.admissionDate, fields.dischargeDate)],
      ['住院天數', <DaysValue key="days" days={stayDays(fields.admissionDate, fields.dischargeDate)} />, true],
    ];
  }
  return [
    ['文件類型', '存摺影本'],
    ['戶名', fields.accountHolder],
    ['銀行', fields.bankName],
    ['帳號', maskAccount(fields.accountLast4)],
  ];
}

function Result({ type, document, requirement, issues, disabled, onReplace, onManual, manualLabel, onHandoff }) {
  const manual = document.entryMethod === 'manual';
  const review = document.status === 'needs_review';
  const missing = manual ? [] : unrecognizedFields(document.fields, FIELD_NAMES[type] ?? []);
  const attention = review || issues.length > 0 || document.requiresRevalidation;
  return (
    <motion.div className="doc-result" initial="hidden" animate="show" variants={staggerChildren(0.06, 0.05)}>
      <motion.div className="doc-result-head" variants={fadeUp}>
        {review
          ? <span className="doc-status is-review"><Icon name="alert" size={12} />待人工確認</span>
          : <span className="doc-status"><CheckDraw size={12} strokeWidth={2.6} />{manual ? '已手動填寫（示範）' : '欄位檢查通過'}</span>}
        <span className="doc-confidence">{manual ? '手動輸入' : `辨識信心 ${Math.round(document.confidence * 100)}%`}</span>
      </motion.div>
      <dl className="doc-fields">
        {fieldRows(type, document.fields).map(([label, value, emphasis]) => (
          <motion.div key={label} className={emphasis ? 'is-emphasis' : ''} variants={fadeUp}>
            <dt>{label}</dt><dd>{value || <Unrecognized />}</dd>
          </motion.div>
        ))}
      </dl>
      {missing.length > 0 && <motion.p className="doc-match is-review" variants={fadeUp}><Icon name="info" size={14} />有 {missing.length} 個欄位未辨識，NAVI 不會自行補上；可替換成較清楚的文件，或由專員確認。</motion.p>}
      {/* Conflicts between documents, quoted from the server (consistencyIssues). */}
      {issues.map(issue => <motion.p key={issue.type} className="doc-match is-review doc-conflict" variants={fadeUp}><Icon name="alert" size={14} />{issue.message}</motion.p>)}
      {document.requiresRevalidation && <motion.p className="doc-match is-review" variants={fadeUp}><Icon name="info" size={14} />這份文件是修正需求前上傳的，請重新上傳確認；目前不計入準備完成度。</motion.p>}
      {review && !document.requiresRevalidation && issues.length === 0 && (
        <motion.p className="doc-match is-review" variants={fadeUp}><Icon name="info" size={14} />部分欄位不完整或與其他資料不一致，需要確認後才會計入。</motion.p>
      )}
      {!attention && (
        <motion.p className="doc-match" variants={fadeUp}>
          <Icon name="check" size={14} strokeWidth={2.2} />符合項目：{requirement?.name ?? documentSpecs[type].match}
        </motion.p>
      )}
      {/* Fixture results are never presented as AI recognition; a passed check is never an authenticity check. */}
      {!manual && <motion.p className="doc-filename" variants={fadeUp}>{document.filename} · {document.isMock ? '示範模式・合成資料，非真實文件分析' : review ? 'Live AI 辨識・待人工確認' : 'Live AI 辨識・欄位檢查通過，尚未驗證文件真偽'}</motion.p>}
      {!manual && !document.isMock && document.verification && (
        <motion.p className="doc-scope" variants={fadeUp}>檢查範圍：只檢查欄位是否齊全、前後一致；未驗證文件真偽，也未判斷理賠資格。</motion.p>
      )}
      <motion.div className="doc-result-actions" variants={fadeUp}>
        <button type="button" className={attention ? 'button button-secondary button-small' : 'link-button'} disabled={disabled} onClick={onReplace}>替換文件<Icon name="upload" size={14} /></button>
        {attention && onManual && <button type="button" className="link-button" disabled={disabled} onClick={onManual}>{manualLabel}</button>}
        {attention && onHandoff && <button type="button" className="link-button" disabled={disabled} onClick={onHandoff}><Icon name="headset" size={14} />轉由專員協助</button>}
      </motion.div>
    </motion.div>
  );
}

/** Formal mode: information the user typed. Stored as 待確認 — never shown as a recognised document. */
function PendingInformation({ type, information, disabled, onUpload, onSample, sampleLabel, onEdit, onRemove }) {
  const rows = unverifiedForms[type].filter(f => information.fields[f.name] != null);
  const spec = documentSpecs[type];
  return (
    <motion.div className="doc-pending" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: transition.enter }} exit={{ opacity: 0, transition: transition.exit }}>
      <div className="doc-result-head">
        <span className="doc-status is-review"><Icon name="info" size={12} />待確認資訊・尚未驗證</span>
        <span className="doc-confidence">你手動提供</span>
      </div>
      <dl className="doc-fields">
        {rows.map(f => (
          <div key={f.name}><dt>{f.label}</dt><dd>{f.name === 'accountLast4' ? `末四碼 ${information.fields[f.name]}` : f.name === 'reportedInpatientDays' ? `${information.fields[f.name]} 天` : information.fields[f.name]}</dd></div>
        ))}
      </dl>
      <p className="doc-match is-review"><Icon name="info" size={14} />不計入準備完成度。請上傳{spec.title}由系統驗證，或由專員確認。</p>
      <div className="doc-pending-actions">
        <button type="button" className="button button-secondary button-small" disabled={disabled} onClick={onUpload}>上傳文件<Icon name="upload" size={15} /></button>
        {onSample && <button type="button" className="link-button" disabled={disabled} onClick={onSample}>{sampleLabel}</button>}
        <button type="button" className="link-button" disabled={disabled} onClick={onEdit}>編輯資訊</button>
        <button type="button" className="link-button" disabled={disabled} onClick={onRemove}>移除</button>
      </div>
    </motion.div>
  );
}

function useElapsedSeconds(since) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
}

/**
 * Real states only: bytes actually sent (uploading), then the server reading the file (analyzing, no
 * percentage — its duration is unknown), or /demo where nothing is sent.
 */
// recognizer: who reads the file on the server — 'AI' (Gemini) or '示範資料' (a demo server's fixed results).
function Analyzing({ state, title, limitSeconds, onCancel, recognizer = 'AI' }) {
  const phase = state?.phase ?? 'sending';
  const elapsed = useElapsedSeconds(phase === 'analyzing' ? state.analyzingSince : phase === 'sending' ? state.startedAt : null);
  const waited = `已等待 ${elapsed} 秒${limitSeconds ? `，最長約 ${limitSeconds} 秒` : ''}`;
  const percent = phase === 'uploading' && state.total ? Math.min(100, Math.round((state.loaded / state.total) * 100)) : null;
  return (
    <motion.div className="doc-analyzing" role="status" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: transition.fast }} exit={{ opacity: 0, transition: transition.exit }}>
      {phase === 'uploading' ? (
        <div className="doc-upload">
          <div className="doc-upload-bar" role="progressbar" aria-label={`${title}上傳進度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
            <span style={{ width: `${percent ?? 0}%` }} />
          </div>
          <p><strong>正在上傳{percent !== null ? ` ${percent}%` : '…'}</strong>檔案傳送完成後由 {recognizer} 辨識</p>
          <button type="button" className="link-button" onClick={onCancel}>取消上傳</button>
        </div>
      ) : (
        <>
          <div className="doc-skeleton" aria-hidden="true">
            <span className="shimmer w-40" /><span className="shimmer w-70" /><span className="shimmer w-55" /><span className="shimmer w-65" />
          </div>
          {phase === 'analyzing' && <p><strong>{recognizer === 'AI' ? 'AI 正在辨識文件…' : '正在以示範資料辨識…'}</strong>{waited}；整理欄位並比對文件要求</p>}
          {/* No byte count from this browser: one honest state for sending and reading. */}
          {phase === 'sending' && <p><strong>正在上傳並辨識文件…</strong>{waited}</p>}
          {phase === 'demo' && <p><strong>正在套用示範資料…</strong>示範模式使用合成資料，不會上傳或讀取你的檔案</p>}
        </>
      )}
    </motion.div>
  );
}

/** A failed upload: the server's message and the actions that fit its error code (domain/documentRecovery.js). */
function Failed({ state, kept, onKeep, onReselect, onRetrySame, onManual, manualLabel, onHandoff }) {
  const recovery = documentRecovery(state?.code);
  const buttons = recovery.actions.map(action => {
    if (action === 'reselect') return <button key={action} type="button" className="button button-secondary button-small" onClick={onReselect}>重新選擇文件<Icon name="upload" size={15} /></button>;
    if (action === 'retry' && state?.retrySource) return <button key={action} type="button" className="button button-secondary button-small" onClick={onRetrySame}>用同一份文件再試一次</button>;
    if (action === 'manual' && onManual) return <button key={action} type="button" className="button button-ghost button-small" onClick={onManual}>{manualLabel}<Icon name="edit" size={15} /></button>;
    if (action === 'handoff' && onHandoff) return <button key={action} type="button" className="link-button" onClick={onHandoff}><Icon name="headset" size={14} />轉由專員協助</button>;
    return null;
  }).filter(Boolean);
  return (
    <motion.div className="doc-failed" role="alert" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: transition.enter }} exit={{ opacity: 0, transition: transition.exit }}>
      <Icon name="alert" size={18} />
      <div>
        <strong>{recovery.title}</strong>
        <p>{state?.message ?? recovery.fallback}</p>
        <p className="doc-failed-note">{kept ? '原本的文件仍保留，準備完成度沒有改變。' : '準備完成度沒有改變。'}</p>
        <div className="doc-failed-actions">
          {buttons.length ? buttons : <button type="button" className="button button-secondary button-small" onClick={onReselect}>重新選擇文件<Icon name="upload" size={15} /></button>}
          {kept && <button type="button" className="link-button" onClick={onKeep}>保留原本的文件</button>}
        </div>
      </div>
    </motion.div>
  );
}

export default function DocumentCard({ type, document, requirement, issues = [], manualInformation, manualVerifies = true, uiState, busy, analysisLimitSeconds = null, onUpload, onCancel, onSample, sampleByAi = false, onRemove, onManual, onRemoveManual, onRetry, onHandoff, registerInput }) {
  const spec = documentSpecs[type];
  // Name, description and whether it is required come from the journey's requirement (the server's list).
  const title = requirement?.name ?? spec.title;
  const input = useRef(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const processing = uiState?.status === 'processing';
  const failed = uiState?.status === 'failed';
  const manual = uiState?.status === 'manual' && Boolean(onManual);
  const disabled = Boolean(busy);

  function receive(files) {
    depth.current = 0; setDragging(false);
    if (disabled) return;
    if (files.length !== 1) { setError('請一次上傳一份文件。'); return; }
    const problem = validateFile(files[0]);
    setError(problem ?? '');
    if (!problem) onUpload(type, { file: files[0] });
  }
  function bindInput(el) { input.current = el; registerInput?.(type, el); }

  const pending = !document && Boolean(manualInformation);
  // A failed replacement is shown over the kept document until the user picks what to do.
  const state = processing ? 'analyzing' : manual ? 'manual' : failed ? 'failed' : document ? 'result' : pending ? 'pending' : 'empty';
  // Formal mode offers manual entry up front, clearly as unverified information.
  const manualLabel = manualVerifies ? '手動輸入' : '先提供資訊（尚未驗證）';
  // Formal mode: the synthetic sample is read by the AI, not filled in locally.
  // sampleByAi: true (the server's AI reads the synthetic file), 'demo' (a demo server answers), false (/demo, local).
  const sampleLabel = sampleByAi === 'demo' ? '使用合成範例（示範資料辨識）' : sampleByAi ? '使用合成範例（由 AI 辨識）' : `使用範例${spec.title}`;

  // A dropped file replaces a document already there (the server keeps one per type).
  return (
    <motion.article
      layout="position" transition={transition.normal}
      className={`doc-card is-${state} ${dragging ? 'is-dragging' : ''}`} data-document={type} aria-busy={processing}
      onDragEnter={e => { e.preventDefault(); depth.current += 1; if (!disabled) setDragging(true); }}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'; }}
      onDragLeave={e => { e.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
      onDrop={e => { e.preventDefault(); receive(Array.from(e.dataTransfer.files)); }}
    >
      <header className="doc-header">
        <span className="doc-icon">{document ? <CheckDraw size={16} strokeWidth={2.2} /> : <Icon name={type === 'bank_passbook' ? 'bank' : 'document'} size={17} />}</span>
        <div>
          <h3>{title}</h3>
          <p>{requirement?.description ?? spec.hint}</p>
        </div>
        {document ? (
          <button type="button" className="icon-button" aria-label={`移除${title}`} aria-expanded={confirmingRemoval} disabled={disabled} onClick={() => setConfirmingRemoval(true)}>
            <Icon name="trash" size={16} />
          </button>
        ) : requirement && <span className="doc-gain">{requirement.required ? '必要' : '依情況'}</span>}
      </header>

      {confirmingRemoval && document && (
        <div className="doc-confirm" role="group" aria-label={`確認移除${title}`}>
          <p>移除這份文件？伺服器會刪除辨識出的欄位，準備完成度會重新計算。</p>
          <div>
            <button type="button" className="button button-ghost button-small" onClick={() => setConfirmingRemoval(false)}>取消</button>
            <button type="button" className="button button-secondary button-small" disabled={disabled} onClick={() => { setConfirmingRemoval(false); onRemove(type); }}>移除文件</button>
          </div>
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {state === 'analyzing' && <Analyzing key="analyzing" state={uiState} title={title} limitSeconds={analysisLimitSeconds} onCancel={() => onCancel?.(type)} recognizer={sampleByAi === 'demo' ? '示範資料' : 'AI'} />}

        {state === 'result' && (
          <motion.div key="result" initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1, transition: spring }} exit={{ opacity: 0, transition: transition.exit }}>
            <Result type={type} document={document} requirement={requirement} issues={issues} disabled={disabled}
              onReplace={() => { setError(''); input.current?.click(); }}
              onManual={!manualVerifies && onManual ? () => onManual(type, null) : null} manualLabel={manualLabel}
              onHandoff={onHandoff} />
          </motion.div>
        )}

        {state === 'failed' && (
          <Failed key="failed" state={uiState} kept={Boolean(document)} onKeep={() => onRetry(type)}
            onReselect={() => { onRetry(type); input.current?.click(); }}
            onRetrySame={() => onUpload(type, uiState.retrySource)}
            onManual={onManual ? () => onManual(type, null) : null} manualLabel={manualLabel} onHandoff={onHandoff} />
        )}

        {state === 'manual' && (
          <motion.div key="manual" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: transition.enter }} exit={{ opacity: 0, transition: transition.exit }}>
            <ManualEntryForm type={type} verifies={manualVerifies} initial={manualInformation?.fields} onSubmit={fields => onManual(type, fields)} onCancel={() => onRetry(type)} />
          </motion.div>
        )}

        {state === 'pending' && (
          <PendingInformation key="pending" type={type} information={manualInformation} disabled={disabled}
            onUpload={() => input.current?.click()} onSample={onSample ? () => onSample(type) : null} sampleLabel={sampleLabel}
            onEdit={() => onManual(type, null)} onRemove={() => onRemoveManual?.(type)} />
        )}

        {state === 'empty' && (
          <motion.div key="empty" className="dropzone" initial={{ opacity: 0 }} animate={{ opacity: 1, scale: dragging ? 1.01 : 1, transition: transition.fast }} exit={{ opacity: 0, transition: transition.exit }}>
            <motion.span className="dropzone-icon" animate={{ y: dragging ? -3 : 0 }} transition={transition.fast}><Icon name="upload" size={20} /></motion.span>
            <p className="dropzone-title">{dragging ? '放開即可上傳' : '拖曳文件到這裡'}</p>
            <p className="dropzone-hint">PDF、PNG、JPG、WebP，10 MB 以內</p>
            <div className="dropzone-actions">
              <button type="button" className="button button-secondary button-small" disabled={disabled} onClick={() => input.current?.click()}>選擇文件</button>
              {onSample && <button type="button" className="link-button" disabled={disabled} onClick={() => { setError(''); onSample(type); }}>{sampleLabel}</button>}
              {!manualVerifies && onManual && <button type="button" className="link-button" disabled={disabled} onClick={() => onManual(type, null)}>{manualLabel}</button>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <input ref={bindInput} className="visually-hidden" type="file" tabIndex={-1} data-upload={type}
        aria-label={`上傳${title}`} accept="application/pdf,image/jpeg,image/png,image/webp" disabled={disabled}
        onChange={e => { receive(Array.from(e.target.files)); e.target.value = ''; }} />
      {error && <p className="inline-error" role="alert"><Icon name="info" size={15} />{error}</p>}
    </motion.article>
  );
}
