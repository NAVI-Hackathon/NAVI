import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Icon from '../Icon.jsx';
import ManualEntryForm, { unverifiedForms } from './ManualEntryForm.jsx';
import { validateFile } from '../../domain/files.js';
import { documentSpecs } from '../../mocks/hospitalClaim.js';
import { maskAccount, stayDays, stayText } from '../../content/format.js';
import { CheckDraw, useCountUp } from '../../motion/primitives.jsx';
import { fadeUp, spring, staggerChildren, transition } from '../../motion/tokens.js';

function DaysValue({ days }) {
  const shown = useCountUp(days ?? 0, { from: 0 });
  return <>{days === null ? '待確認' : `${Math.round(shown)} 天`}</>;
}

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

function Result({ type, document }) {
  const manual = document.entryMethod === 'manual';
  const review = document.status === 'needs_review';
  return (
    <motion.div className="doc-result" initial="hidden" animate="show" variants={staggerChildren(0.06, 0.05)}>
      <motion.div className="doc-result-head" variants={fadeUp}>
        {review
          ? <span className="doc-status is-review"><Icon name="alert" size={12} />需要專員確認</span>
          : <span className="doc-status"><CheckDraw size={12} strokeWidth={2.6} />{manual ? '已手動確認' : '辨識完成'}</span>}
        <span className="doc-confidence">{manual ? '手動輸入' : `辨識信心 ${Math.round(document.confidence * 100)}%`}</span>
      </motion.div>
      <dl className="doc-fields">
        {fieldRows(type, document.fields).map(([label, value, emphasis]) => (
          <motion.div key={label} className={emphasis ? 'is-emphasis' : ''} variants={fadeUp}>
            <dt>{label}</dt><dd>{value || '待確認'}</dd>
          </motion.div>
        ))}
      </dl>
      {review ? (
        <motion.p className="doc-match is-review" variants={fadeUp}>
          <Icon name="info" size={14} />部分欄位不完整或與其他資料不一致，可重新上傳較清楚的文件，或由專員協助確認。
        </motion.p>
      ) : (
        <motion.p className="doc-match" variants={fadeUp}>
          <Icon name="check" size={14} strokeWidth={2.2} />符合項目：{documentSpecs[type].match}
        </motion.p>
      )}
      {/* Fixture results are never presented as AI recognition. */}
      {!manual && <motion.p className="doc-filename" variants={fadeUp}>{document.filename} · {document.isMock ? '示範辨識資料，未讀取文件內容' : 'AI 辨識結果，請核對內容'}</motion.p>}
    </motion.div>
  );
}

/** Formal mode: information the user typed. Stored as 待確認 — never shown as a recognised document. */
function PendingInformation({ type, information, disabled, onUpload, onSample, onEdit, onRemove }) {
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
        <button type="button" className="link-button" disabled={disabled} onClick={onSample}>使用範例{spec.title}</button>
        <button type="button" className="link-button" disabled={disabled} onClick={onEdit}>編輯資訊</button>
        <button type="button" className="link-button" disabled={disabled} onClick={onRemove}>移除</button>
      </div>
    </motion.div>
  );
}

function Analyzing() {
  return (
    <motion.div className="doc-analyzing" role="status" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: transition.fast }} exit={{ opacity: 0, transition: transition.exit }}>
      <div className="doc-skeleton" aria-hidden="true">
        <span className="shimmer w-40" /><span className="shimmer w-70" /><span className="shimmer w-55" /><span className="shimmer w-65" />
      </div>
      <p><strong>正在辨識文件…</strong>整理欄位並比對文件要求</p>
    </motion.div>
  );
}

export default function DocumentCard({ type, document, manualInformation, manualVerifies = true, uiState, busy, onUpload, onRemove, onManual, onRemoveManual, onRetry, registerInput }) {
  const spec = documentSpecs[type];
  const input = useRef(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
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
  const state = processing ? 'analyzing' : manual ? 'manual' : document ? 'result' : failed ? 'failed' : pending ? 'pending' : 'empty';
  // Formal mode offers manual entry up front, clearly as unverified information.
  const manualLabel = manualVerifies ? '手動輸入' : '先提供資訊（尚未驗證）';

  return (
    <motion.article
      layout="position" transition={transition.normal}
      className={`doc-card is-${state} ${dragging ? 'is-dragging' : ''}`} data-document={type} aria-busy={processing}
      onDragEnter={e => { e.preventDefault(); depth.current += 1; if (!disabled && !document) setDragging(true); }}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = disabled || document ? 'none' : 'copy'; }}
      onDragLeave={e => { e.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
      onDrop={e => { e.preventDefault(); if (!document) receive(Array.from(e.dataTransfer.files)); else { depth.current = 0; setDragging(false); } }}
    >
      <header className="doc-header">
        <span className="doc-icon">{document ? <CheckDraw size={16} strokeWidth={2.2} /> : <Icon name={type === 'bank_passbook' ? 'bank' : 'document'} size={17} />}</span>
        <div>
          <h3>{spec.title}</h3>
          <p>{spec.hint}</p>
        </div>
        {document ? (
          <button type="button" className="icon-button" aria-label={`移除${spec.title}`} disabled={disabled} onClick={() => onRemove(type)}>
            <Icon name="trash" size={16} />
          </button>
        ) : <span className="doc-gain">+{spec.gain}%</span>}
      </header>

      <AnimatePresence mode="wait" initial={false}>
        {state === 'analyzing' && <Analyzing key="analyzing" />}

        {state === 'result' && (
          <motion.div key="result" initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1, transition: spring }} exit={{ opacity: 0, transition: transition.exit }}>
            <Result type={type} document={document} />
          </motion.div>
        )}

        {state === 'failed' && (
          <motion.div key="failed" className="doc-failed" role="alert" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: transition.enter }} exit={{ opacity: 0, transition: transition.exit }}>
            <Icon name="alert" size={18} />
            <div>
              <strong>暫時無法辨識這份文件</strong>
              <p>{uiState?.message ?? (onManual ? '你可以重新上傳較清楚的照片，或手動確認文件內容。' : '你可以重新上傳較清楚的照片或 PDF。')}</p>
              <div className="doc-failed-actions">
                <button type="button" className="button button-secondary button-small" onClick={() => { onRetry(type); input.current?.click(); }}>重新上傳<Icon name="upload" size={15} /></button>
                {onManual && <button type="button" className="button button-ghost button-small" onClick={() => onManual(type, null)}>{manualLabel}<Icon name="edit" size={15} /></button>}
              </div>
            </div>
          </motion.div>
        )}

        {state === 'manual' && (
          <motion.div key="manual" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: transition.enter }} exit={{ opacity: 0, transition: transition.exit }}>
            <ManualEntryForm type={type} verifies={manualVerifies} initial={manualInformation?.fields} onSubmit={fields => onManual(type, fields)} onCancel={() => onRetry(type)} />
          </motion.div>
        )}

        {state === 'pending' && (
          <PendingInformation key="pending" type={type} information={manualInformation} disabled={disabled}
            onUpload={() => input.current?.click()} onSample={() => onUpload(type, { sample: true })}
            onEdit={() => onManual(type, null)} onRemove={() => onRemoveManual?.(type)} />
        )}

        {state === 'empty' && (
          <motion.div key="empty" className="dropzone" initial={{ opacity: 0 }} animate={{ opacity: 1, scale: dragging ? 1.01 : 1, transition: transition.fast }} exit={{ opacity: 0, transition: transition.exit }}>
            <motion.span className="dropzone-icon" animate={{ y: dragging ? -3 : 0 }} transition={transition.fast}><Icon name="upload" size={20} /></motion.span>
            <p className="dropzone-title">{dragging ? '放開即可上傳' : '拖曳文件到這裡'}</p>
            <p className="dropzone-hint">PDF、PNG、JPG、WebP，10 MB 以內</p>
            <div className="dropzone-actions">
              <button type="button" className="button button-secondary button-small" disabled={disabled} onClick={() => input.current?.click()}>選擇文件</button>
              <button type="button" className="link-button" disabled={disabled} onClick={() => { setError(''); onUpload(type, { sample: true }); }}>使用範例{spec.title}</button>
              {!manualVerifies && onManual && <button type="button" className="link-button" disabled={disabled} onClick={() => onManual(type, null)}>{manualLabel}</button>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <input ref={bindInput} className="visually-hidden" type="file" tabIndex={-1} data-upload={type}
        aria-label={`上傳${spec.title}`} accept="application/pdf,image/jpeg,image/png,image/webp" disabled={disabled}
        onChange={e => { receive(Array.from(e.target.files)); e.target.value = ''; }} />
      {error && <p className="inline-error" role="alert"><Icon name="info" size={15} />{error}</p>}
    </motion.article>
  );
}
