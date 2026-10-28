import { createHash, randomUUID } from 'node:crypto';
import { JourneyExplanationSchema, HandoffPreviewSchema, HandoffConfirmationSchema, HandoffSummarySchema, HandoffConfirmRequestSchema } from '../../../../shared/competition.js';
import { serviceWorkflow } from './serviceWorkflows.js';
import { getJourneyDefinition, getSources } from './knowledgeService.js';
import { ApiError } from '../middleware/errorHandler.js';

const documentTypes = new Set(['diagnosis_certificate', 'bank_passbook', 'boarding_pass', 'delay_certificate']);
const reasons = {
  VERIFIED: '已符合目前原型的資料檢查，不代表文件真偽或理賠資格已驗證。', OPTIONAL: '這是條件性項目，不列入本原型必要計分；是否需要仍須依來源與實際情況確認。',
  MANUAL_UNVERIFIED: '僅有手動填寫資訊，尚無已驗證文件，因此不計文件分數。',
  DOCUMENT_NEEDS_REVIEW: '文件欄位、辨識信心或交叉比對尚未通過，需要進一步確認。',
  DOCUMENT_MISSING: '尚未提供這項已驗證文件。', INFORMATION_MISSING: '尚缺符合檢查的資訊；如資訊來自文件，須先完成文件驗證。',
  CONFIRMATION_REQUIRED: '尚未完成資料確認；必要文件齊備後才能進行。',
};
export function explainJourney(journey) {
  const criteria = journey.requirements.map(requirement => {
    const manual = journey.manualDocumentInformation?.some(info => info.documentType === requirement.id);
    const reasonCode = requirement.status === 'verified' ? 'VERIFIED' : !requirement.required ? 'OPTIONAL' : requirement.status === 'needs_review' ? 'DOCUMENT_NEEDS_REVIEW' : manual ? 'MANUAL_UNVERIFIED' : requirement.id === 'confirmation' ? 'CONFIRMATION_REQUIRED' : documentTypes.has(requirement.id) ? 'DOCUMENT_MISSING' : 'INFORMATION_MISSING';
    return { ...requirement, earned: journey.supported && requirement.status === 'verified' ? requirement.weight : 0, reasonCode, reason: reasons[reasonCode] };
  });
  return JourneyExplanationSchema.parse({
    journeyId: journey.id, journeyUpdatedAt: journey.updatedAt, readiness: journey.readiness,
    currentStage: journey.currentStage, supported: journey.supported, criteria,
    missingRequirementIds: criteria.filter(r => r.required && r.status !== 'verified').map(r => r.id),
    consistencyIssues: journey.consistencyIssues ?? [], nextAction: journey.nextAction, sources: journey.sources,
    disclaimer: '準備度只表示原型定義的資料準備完成度，不代表保障適用、理賠核准、給付金額或已送出申請。',
  });
}

const concernLabels = {
  FLIGHT_NUMBER_MISMATCH: '航班編號不一致。', DEPARTURE_DATE_MISMATCH: '航班日期不一致。', ORIGIN_MISMATCH: '出發地不一致。', DESTINATION_MISMATCH: '目的地不一致。', PASSENGER_NAME_MISMATCH: '旅客姓名不一致。',
  HOSPITAL_NAME_MISMATCH: '醫院資料不一致。', ADMISSION_DATE_MISMATCH: '住院日期不一致。', DISCHARGE_DATE_MISMATCH: '出院日期不一致。', INPATIENT_DAYS_MISMATCH: '住院天數不一致。', PATIENT_NAME_MISMATCH: '文件中的姓名不一致。',
};
export function redactedHandoff(journey) {
  const definition = getJourneyDefinition(journey.serviceType);
  const flow = journey.workflowId ? serviceWorkflow(journey.workflowId) : null;
  const names = new Map((flow ? journey.requirements : definition?.requirements ?? []).map(r => [r.id, r.name]));
  // Allowlisted labels only: no free-text narrative, names, clinical dates, file names or bank digits.
  return HandoffSummarySchema.parse({
    issue: flow?.title ?? definition?.title ?? '待確認的服務需求',
    collected: journey.requirements.filter(r => r.status === 'verified' && names.has(r.id)).map(r => names.get(r.id)),
    missing: journey.requirements.filter(r => r.required && r.status !== 'verified' && names.has(r.id)).map(r => names.get(r.id)),
    concerns: [...new Set((journey.consistencyIssues ?? []).map(issue => concernLabels[issue.type]).filter(Boolean))],
    reason: journey.nextAction.type === 'CONTACT_SPECIALIST' ? '目前資料或文件需要專員進一步確認。' : '服務條件與最終結果仍須依實際條款及專員確認。',
    provider: journey.provider, sources: flow ? journey.sources : getSources(definition?.sourceIds ?? []), redacted: true,
    disclaimer: '此摘要已省略個人、醫療與銀行欄位；確認只取得摘要，不會送交專員、申請理賠或改變服務準備度。',
  });
}
const revision = journey => createHash('sha256').update(JSON.stringify(journey)).digest('hex');
export const HANDOFF_PREVIEW_TTL_MS = 10 * 60 * 1000;
export function createHandoffConfirmationService({ getJourney, now = Date.now, maxEntries = 100 }) {
  // shortcut: single-process demo previews expire after ten minutes; use authenticated durable consent storage before real handoff.
  const previews = new Map();
  const prune = () => { for (const [id, entry] of previews) if (entry.expiresAt <= now()) previews.delete(id); };
  return {
    preview(id) {
      const apply = journey => {
      prune();
      for (const [key, entry] of previews) if (entry.preview.journeyId === id) previews.delete(key);
      if (previews.size >= maxEntries) throw new ApiError('HANDOFF_CAPACITY_REACHED', '預覽數量較多，請稍後再試。', 503, true);
      const expiresAt = now() + HANDOFF_PREVIEW_TTL_MS;
      const preview = HandoffPreviewSchema.parse({ previewId: randomUUID(), journeyId: id, expiresAt: new Date(expiresAt).toISOString(), status: 'awaiting_confirmation', summary: redactedHandoff(journey) });
      previews.set(preview.previewId, { preview, expiresAt, revision: revision(journey) });
      return structuredClone(preview);
      };const value=getJourney(id);return value?.then?value.then(apply):apply(value);
    },
    confirm(id, input) {
      const parsed = HandoffConfirmRequestSchema.safeParse(input);
      if (!parsed.success) throw new ApiError('INVALID_INPUT', '請先查看摘要並明確確認。', 400, false);
      const { previewId } = parsed.data;
      const apply = journey => {
      prune();
      const entry = previews.get(previewId);
      if (!entry || entry.preview.journeyId !== id) throw new ApiError('HANDOFF_PREVIEW_INVALID', '預覽已失效，請重新查看摘要後確認。', 409, false);
      if (entry.revision !== revision(journey)) {
        previews.delete(previewId);
        throw new ApiError('HANDOFF_PREVIEW_STALE', '案件資料已更新，請重新查看摘要後確認。', 409, false);
      }
      previews.delete(previewId);
      return HandoffConfirmationSchema.parse({ previewId, journeyId: id, confirmedAt: new Date(now()).toISOString(), status: 'confirmed', delivery: 'not_sent', summary: entry.preview.summary });
      };const value=getJourney(id);return value?.then?value.then(apply):apply(value);
    },
  };
}
