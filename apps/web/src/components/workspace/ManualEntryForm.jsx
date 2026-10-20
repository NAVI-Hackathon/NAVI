import { useState } from 'react';
import Icon from '../Icon.jsx';
import { manualSchemas } from '../../services/journeyEngine.js';
import { ManualDocumentInformationRequestSchema } from '../../../../../shared/journey.js';

// /demo: the local engine accepts the full document contents as confirmed demo data.
const localForms = {
  diagnosis_certificate: [
    { name: 'patientName', label: '病患姓名', placeholder: '與診斷書相同' },
    { name: 'hospitalName', label: '醫院', placeholder: '例如 臺中榮民總醫院' },
    { name: 'admissionDate', label: '入院日期', type: 'date' },
    { name: 'dischargeDate', label: '出院日期', type: 'date' },
    { name: 'diagnosis', label: '診斷', placeholder: '診斷書上的病名' },
  ],
  bank_passbook: [
    { name: 'accountHolder', label: '戶名', placeholder: '與存摺封面相同' },
    { name: 'bankName', label: '銀行或郵局', placeholder: '例如 某某銀行' },
    { name: 'accountLast4', label: '帳號末四碼', placeholder: '例如 1234', inputMode: 'numeric', maxLength: 4 },
  ],
};

// Formal mode: only the fields the backend accepts as unverified information. No names,
// diagnosis or full account numbers; every field is optional but at least one is required.
export const unverifiedForms = {
  diagnosis_certificate: [
    { name: 'hospitalName', label: '醫院', placeholder: '例如 臺中榮民總醫院' },
    { name: 'admissionDate', label: '入院日期', type: 'date' },
    { name: 'dischargeDate', label: '出院日期', type: 'date' },
    { name: 'reportedInpatientDays', label: '住院天數', placeholder: '例如 5', inputMode: 'numeric', maxLength: 4, number: true },
  ],
  bank_passbook: [
    { name: 'bankName', label: '銀行或郵局', placeholder: '例如 某某銀行' },
    { name: 'accountLast4', label: '帳號末四碼', placeholder: '例如 1234', inputMode: 'numeric', maxLength: 4 },
  ],
};

function parseUnverified(type, values) {
  const fields = Object.fromEntries(unverifiedForms[type].map(f => {
    const raw = values[f.name].trim();
    return [f.name, raw === '' ? null : f.number ? Number(raw) : raw];
  }));
  if (fields.admissionDate && fields.dischargeDate && fields.dischargeDate < fields.admissionDate) return { error: '出院日期需晚於或等於入院日期。' };
  const result = ManualDocumentInformationRequestSchema.safeParse({ documentType: type, fields });
  if (result.success) return { fields: result.data.fields };
  return { error: Object.values(fields).every(v => v === null) ? '請至少填寫一項文件資訊。' : '請確認格式：帳號只填末四碼，住院天數填數字。' };
}

function parseLocal(type, values) {
  const result = manualSchemas[type].safeParse(values);
  if (result.success) return { fields: result.data };
  const message = result.error.issues.find(i => /晚於/.test(i.message))?.message;
  return { error: message ? `${message}。` : '請完整填寫所有欄位。' };
}

/** `verifies`: true in /demo (fields count as confirmed); false in formal mode (stored as 待確認). */
export default function ManualEntryForm({ type, verifies = true, initial, onSubmit, onCancel }) {
  const fields = (verifies ? localForms : unverifiedForms)[type];
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(f => [f.name, initial?.[f.name] == null ? '' : String(initial[f.name])])));
  const [error, setError] = useState('');

  function submit(event) {
    event.preventDefault();
    const result = verifies ? parseLocal(type, values) : parseUnverified(type, values);
    if (result.error) { setError(result.error); return; }
    onSubmit(result.fields);
  }

  return (
    <form className="manual-form" onSubmit={submit} noValidate>
      <p className="manual-intro">
        <Icon name="edit" size={15} />
        {verifies
          ? '請依文件上的內容填寫，送出後會更新準備完成度。'
          : '先記下文件上的資訊。這些內容會標示為「待確認」，不會計入準備完成度；仍需上傳文件或由專員確認。'}
      </p>
      <div className="manual-grid">
        {fields.map(f => (
          <label key={f.name} className="field">
            <span>{f.label}{!verifies && <small className="field-optional">選填</small>}</span>
            <input type={f.type ?? 'text'} value={values[f.name]} placeholder={f.placeholder} maxLength={f.maxLength ?? 60} inputMode={f.inputMode}
              onChange={e => { setValues(v => ({ ...v, [f.name]: e.target.value })); setError(''); }} />
          </label>
        ))}
      </div>
      {error && <p className="inline-error" role="alert"><Icon name="info" size={15} />{error}</p>}
      <div className="manual-actions">
        <button type="button" className="button button-ghost button-small" onClick={onCancel}>取消</button>
        <button type="submit" className="button button-primary button-small">{verifies ? '確認內容' : '送出待確認資訊'}<Icon name="check" size={15} /></button>
      </div>
    </form>
  );
}
