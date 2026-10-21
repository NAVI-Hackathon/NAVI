// Claim Preflight: sort the journey's requirements into groups the user can act on.
// The grouping follows the server's reason codes (GET /journeys/:id/explanation, shared/competition.js).
// /demo has no server, so localCriteria() mirrors the same rules; nothing is scored here.
import { maskAccount, stayText } from '../content/format.js';

const DOCUMENT_TYPES = new Set(['diagnosis_certificate', 'bank_passbook', 'boarding_pass', 'delay_certificate']);
const fieldLabels = {
  patientName: '病患姓名', hospitalName: '醫院名稱', admissionDate: '入院日期', dischargeDate: '出院日期',
  accountHolder: '戶名', bankName: '銀行', accountLast4: '帳號末四碼',
};
const groupOf = {
  VERIFIED: 'obtained', OPTIONAL: 'optional',
  DOCUMENT_NEEDS_REVIEW: 'review', MANUAL_UNVERIFIED: 'review',
  DOCUMENT_MISSING: 'missing', INFORMATION_MISSING: 'missing', CONFIRMATION_REQUIRED: 'missing',
};

const documentOf = (journey, type) => journey.documents.find(d => d.documentType === type);

/** Same decision order as the server's explainJourney; used when no explanation is available (/demo). */
export function localCriteria(journey) {
  return journey.requirements.map(requirement => {
    const manual = journey.manualDocumentInformation?.some(info => info.documentType === requirement.id);
    const reasonCode = requirement.status === 'verified' ? 'VERIFIED' : !requirement.required ? 'OPTIONAL'
      : requirement.status === 'needs_review' ? 'DOCUMENT_NEEDS_REVIEW' : manual ? 'MANUAL_UNVERIFIED'
        : requirement.id === 'confirmation' ? 'CONFIRMATION_REQUIRED' : DOCUMENT_TYPES.has(requirement.id) ? 'DOCUMENT_MISSING' : 'INFORMATION_MISSING';
    return { ...requirement, earned: journey.supported !== false && requirement.status === 'verified' ? requirement.weight : 0, reasonCode };
  });
}

/** What a verified requirement is backed by, in a few words. */
function obtainedDetail(journey, requirement) {
  const days = journey.claimContext?.inpatient?.days;
  switch (requirement.id) {
    case 'incident': return '已整理你的住院情況';
    case 'service': return journey.claimContext?.hospital?.matchedName ? `${journey.claimContext.hospital.matchedName}・醫起通合作醫院` : '已辨識為住院醫療理賠';
    case 'diagnosis_certificate': {
      const fields = documentOf(journey, 'diagnosis_certificate')?.fields ?? {};
      return [fields.hospitalName, fields.admissionDate && stayText(fields.admissionDate, fields.dischargeDate)].filter(Boolean).join('・') || '文件已驗證';
    }
    case 'inpatient_info': return days ? `住院 ${days} 天（依文件整理，不是給付日數）` : '住院資訊已整理';
    case 'bank_passbook': {
      const fields = documentOf(journey, 'bank_passbook')?.fields ?? {};
      return [fields.bankName, fields.accountLast4 && maskAccount(fields.accountLast4)].filter(Boolean).join('　') || '文件已驗證';
    }
    case 'confirmation': return '你已確認資料並填妥保險金申請書';
    default: return requirement.description;
  }
}

/** Why a document needs a person: the server's consistency messages first, otherwise the empty fields. */
function reviewReasons(journey, document) {
  const issues = (journey.consistencyIssues ?? []).filter(issue => issue.documentIds.includes(document.id)).map(issue => issue.message);
  if (issues.length) return issues;
  const empty = Object.entries(document.fields).filter(([key, value]) => fieldLabels[key] && value == null).map(([key]) => fieldLabels[key]);
  return [empty.length ? `文件上找不到：${empty.join('、')}` : '文件內容無法確認，需要專員協助核對'];
}

function missingItem(journey, criterion, base) {
  if (criterion.reasonCode === 'DOCUMENT_MISSING') {
    return { ...base, detail: criterion.description, action: { type: 'upload', target: criterion.id, label: '上傳文件' } };
  }
  if (criterion.reasonCode === 'CONFIRMATION_REQUIRED') {
    const ready = journey.nextAction.type === 'REVIEW_INFORMATION';
    return { ...base, detail: ready ? '文件已備齊，請確認資料並填妥保險金申請書。' : '必要文件備齊後，就可以確認資料。', action: ready ? { type: 'review' } : null };
  }
  // INFORMATION_MISSING:住院資訊 comes from the certificate.
  const certificate = documentOf(journey, 'diagnosis_certificate');
  const detail = criterion.id !== 'inpatient_info' ? criterion.description
    : !certificate ? '上傳診斷書或住院證明後，會自動整理醫院與住院期間。'
      : certificate.status !== 'verified' ? '診斷書或住院證明確認後，才會整理住院資訊。'
        : '文件上沒有有效的住院期間或住院天數，可重新上傳或請專員確認。';
  return { ...base, detail };
}

/**
 * @param explanation optional server explanation; used only when it matches this journey version.
 * @returns {{ obtained: Item[], missing: Item[], review: Item[], optional: Item[] }}
 * Item = { id, title, detail?, reasons?, earned?, action? } where action is one of
 * { type: 'upload', target, label } | { type: 'review' } | { type: 'handoff' }.
 */
export function buildPreflight(journey, { explanation = null } = {}) {
  const current = explanation && explanation.journeyId === journey.id && explanation.journeyUpdatedAt === journey.updatedAt;
  const criteria = current ? explanation.criteria : localCriteria(journey);
  const groups = { obtained: [], missing: [], review: [], optional: [] };
  const reviewDocuments = new Set();

  for (const criterion of criteria) {
    const base = { id: criterion.id, title: criterion.name };
    const group = groupOf[criterion.reasonCode] ?? 'missing';
    if (group === 'obtained') groups.obtained.push({ ...base, detail: obtainedDetail(journey, criterion), earned: criterion.earned });
    else if (group === 'optional') groups.optional.push(base);
    else if (group === 'missing') groups.missing.push(missingItem(journey, criterion, base));
    else if (criterion.reasonCode === 'MANUAL_UNVERIFIED') {
      groups.review.push({ ...base, title: `${criterion.name}（你提供的資訊）`, reasons: ['你提供的資訊尚未驗證，不計入準備完成度；上傳文件即可驗證'], action: { type: 'upload', target: criterion.id, label: '上傳文件驗證' } });
    } else {
      const document = documentOf(journey, criterion.id);
      if (document) reviewDocuments.add(document.id);
      groups.review.push({ ...base, reasons: document ? reviewReasons(journey, document) : ['需要專員協助確認'], action: { type: 'upload', target: criterion.id, label: '重新上傳' } });
    }
  }

  // Issues the server raised that are not already explained by a document above.
  for (const issue of journey.consistencyIssues ?? []) {
    if (issue.documentIds.some(id => reviewDocuments.has(id))) continue;
    groups.review.push({ id: `issue-${issue.type}`, title: '文件內容不一致', reasons: [issue.message], action: { type: 'handoff' } });
  }
  return groups;
}

// Concern labels mirror the server's allowlist: no names, dates or values, only what kind of mismatch.
const concernLabels = {
  HOSPITAL_NAME_MISMATCH: '醫院資料不一致。', ADMISSION_DATE_MISMATCH: '住院日期不一致。', DISCHARGE_DATE_MISMATCH: '出院日期不一致。',
  INPATIENT_DAYS_MISMATCH: '住院天數不一致。', PATIENT_NAME_MISMATCH: '文件中的姓名不一致。',
};

/**
 * /demo stand-in for POST /journeys/:id/handoff/preview → summary (HandoffSummarySchema shape).
 * Allowlisted labels only: no description, names, hospital, dates, file names or bank digits.
 */
export function localHandoffSummary(journey) {
  return {
    issue: journey.title,
    collected: journey.requirements.filter(r => r.status === 'verified').map(r => r.name),
    missing: journey.requirements.filter(r => r.required && r.status !== 'verified').map(r => r.name),
    concerns: [...new Set((journey.consistencyIssues ?? []).map(issue => concernLabels[issue.type]).filter(Boolean))],
    reason: journey.nextAction.type === 'CONTACT_SPECIALIST' ? '目前資料或文件需要專員進一步確認。' : '服務條件與最終結果仍須依實際條款及專員確認。',
    provider: 'demo', sources: journey.sources, redacted: true,
    disclaimer: '此摘要已省略個人、醫療與銀行欄位；確認只取得摘要，不會送交專員、申請理賠或改變服務準備度。',
  };
}
