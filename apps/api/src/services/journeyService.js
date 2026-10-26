import { randomUUID } from 'node:crypto';
import { ServiceJourneySchema, ManualDocumentInformationRequestSchema } from '../../../../shared/journey.js';
import { MAX_MESSAGE_LENGTH } from '../../../../shared/intelligence.js';
import { understandIntent } from './intent.service.js';
import { normalizeIntent, HOSPITAL_SUMMARY } from '../schemas/intent.schema.js';
import { getJourneyDefinition, getSources } from './knowledgeService.js';
import { deriveJourney } from '../workflow/journeyStateMachine.js';
import { analyzeDocument } from './documentService.js';
import { ApiError } from '../middleware/errorHandler.js';
import { redactIdentifiers } from '../utils/privacy.js';
import { findHospitalMention, reportedStayDays } from '../../../../shared/hospitalization.js';

const titles = { hospitalization_claim: '住院醫療理賠', vehicle_accident: '車輛事故', payment_method_change: '更改繳費方式', policy_change: '保單變更', policy_information: '保單資訊', unknown: '需要補充說明' };

export function createJourneyService({ repository, provider, config }) {
  // Track only pending work; expiry/restart needs no persistent lock state.
  const pending = new Map();
  const invalidatePending = id => { for (const work of pending.get(id) ?? []) work.invalidated = true; };
  async function analyzeForJourney(id, operation, task) {
    const work = { operation, invalidated: false };
    const jobs = pending.get(id) ?? new Set();
    if ([...jobs].some(job => job.operation === operation)) throw new ApiError('JOURNEY_BUSY', '同一項資料正在分析，請稍後再試。', 409, true);
    jobs.add(work); pending.set(id, jobs);
    try {
      const value = await task();
      if (work.invalidated) throw new ApiError('JOURNEY_STALE', '案件資料已更新，這次分析未套用，請確認目前旅程後再試。', 409, false);
      return value;
    } finally { jobs.delete(work); if (!jobs.size) pending.delete(id); }
  }
  const save = journey => repository.save(ServiceJourneySchema.parse(deriveJourney({ ...journey, updatedAt: new Date().toISOString() }, config)));
  function get(id) {
    const journey = repository.get(id);
    if (!journey) throw new ApiError('JOURNEY_NOT_FOUND', '這份服務旅程已失效或不存在，請重新開始。', 404, false);
    return journey;
  }
  function editable(journey) {
    if (!journey.supported) throw new ApiError('SERVICE_NOT_SUPPORTED', '目前尚未開放這項服務的完整旅程。', 409, false);
    if (journey.confidence < (journey.serviceType === 'hospitalization_claim' ? config.confidenceThreshold : config.journeyConfidenceThreshold)) throw new ApiError('HUMAN_REVIEW_REQUIRED', '這個情況需要由專員協助確認。', 409, false);
  }
  return {
    get,
    async create({ message, intentResult }, signal, trustedIntentResult) {
      // Only a server receipt may reuse a live intent; browser-supplied facts never bypass Gemini.
      const supplied = provider.mode === 'live' || provider.mode === 'unavailable' ? trustedIntentResult : intentResult;
      const data = supplied ? normalizeIntent(supplied, message) : (await understandIntent(message, { provider, config, signal })).data;
      if (data.serviceType === 'hospitalization_claim' && data.intent === 'knowledge_query') throw new ApiError('SERVICE_NOT_SUPPORTED', '請先查詢相關服務資訊，確認要申辦時再開始服務旅程。', 409, false);
      const definition = getJourneyDefinition(data.serviceType);
      if (data.serviceType === 'hospitalization_claim') {
        // Fill explicit local mentions for clients using the pre-PR schema; never infer dates.
        data.extractedData.hospitalName ??= findHospitalMention(message);
        data.extractedData.reportedInpatientDays ??= reportedStayDays(message);
      }
      const now = new Date().toISOString();
      // Retain structured stay facts, not free-text clinical descriptions or provider narratives.
      const hospital = data.serviceType === 'hospitalization_claim';
      const summary = hospital ? HOSPITAL_SUMMARY : `使用者希望取得${definition?.title ?? titles[data.serviceType]}相關服務協助。`;
      const conversation = hospital ? '使用者詢問住院醫療理賠；原始描述不留存。' : '使用者描述服務需求；原始描述不留存。';
      return save({ id: randomUUID(), serviceType: data.serviceType, title: definition?.title ?? titles[data.serviceType], summary: summary.slice(0, ServiceJourneySchema.shape.summary.maxLength), confidence: data.confidence, extractedData: data.extractedData, documents: [], conversation: [{ role: 'user', message: conversation.slice(0, MAX_MESSAGE_LENGTH), createdAt: now }], confirmed: false, supported: Boolean(definition), provider: provider.mode === 'live' ? 'live' : supplied ? 'provided' : provider.mode === 'demo' ? 'demo' : 'live', sources: getSources(definition?.sourceIds ?? []), createdAt: now, disclaimer: definition?.disclaimer ?? '目前僅辨識需求，不提供理賠資格或保障結論。' });
    },
    async correctIntent(id, message, signal) {
      const previous = get(id);
      const data = await analyzeForJourney(id, 'intent', () => understandIntent(message, { provider, config, signal }));
      invalidatePending(id);
      const current = get(id);
      const intent = data.data.intent === 'knowledge_query' ? normalizeIntent({ ...data.data, intent: 'unknown', serviceType: 'unknown' }) : data.data;
      const definition = getJourneyDefinition(intent.serviceType);
      const { claimContext, officialSources, ...retained } = current;
      const journey = save({ ...retained, serviceType: intent.serviceType, title: definition?.title ?? titles[intent.serviceType], summary: intent.serviceType === 'hospitalization_claim' ? HOSPITAL_SUMMARY : '需求已修正，請確認目前想處理的服務。', confidence: intent.confidence, extractedData: intent.extractedData, confirmed: false, sources: getSources(definition?.sourceIds ?? []), disclaimer: definition?.disclaimer ?? '需求已修正；保留文件僅供確認，不代表目前服務適用或理賠核准。' });
      return { journey, previousServiceType: previous.serviceType, evidenceRetained: true, requiresRevalidation: true };
    },
    addManualDocumentInformation(id, input) {
      const current = get(id);
      editable(current);
      if (current.serviceType !== 'hospitalization_claim') throw new ApiError('SERVICE_NOT_SUPPORTED', '目前僅支援住院服務的手動文件資訊。', 409, false);
      const parsed = ManualDocumentInformationRequestSchema.safeParse(input);
      if (!parsed.success) throw new ApiError('INVALID_INPUT', '請提供有效的待確認文件資訊，請勿輸入完整帳號或醫療內容。', 400, false);
      const { documentType, fields } = parsed.data;
      const information = { documentType, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === 'string' && key !== 'accountLast4' ? redactIdentifiers(value) : value])), source: 'manual', status: 'needs_review', updatedAt: new Date().toISOString() };
      const manualDocumentInformation = [...(current.manualDocumentInformation ?? []).filter(item => item.documentType !== documentType), information];
      // Do not write to documents or extractedData: only verified uploads can affect readiness.
      invalidatePending(id);
      const journey = save({ ...current, manualDocumentInformation, confirmed: false });
      return { information, journey, readinessChange: { before: current.readiness, after: journey.readiness } };
    },
    removeManualDocumentInformation(id, documentType) {
      const current = get(id);
      if (!(current.manualDocumentInformation ?? []).some(item => item.documentType === documentType)) throw new ApiError('MANUAL_INFORMATION_NOT_FOUND', '找不到這份手動資訊。', 404, false);
      invalidatePending(id);
      return save({ ...current, manualDocumentInformation: current.manualDocumentInformation.filter(item => item.documentType !== documentType) });
    },
    async addDocument(id, upload, signal) {
      const initial = get(id);
      editable(initial);
      const document = await analyzeForJourney(id, upload.documentType ?? 'document', () => analyzeDocument(upload, { provider, config, signal }));
      if (upload.documentType && upload.documentType !== 'unknown' && upload.documentType !== document.documentType) throw new ApiError('DOCUMENT_TYPE_MISMATCH', '文件內容與選擇的類型不同，請確認後重新上傳。', 422, false);
      // Read again after asynchronous analysis so concurrent uploads retain one another's documents.
      const current = get(id);
      editable(current);
      const manual = current.manualDocumentInformation?.find(item => item.documentType === 'bank_passbook');
      if (provider.mode === 'live' && document.documentType === 'bank_passbook' && manual && ['bankName', 'accountLast4'].some(key => manual.fields[key] && document.fields[key] && String(manual.fields[key]).normalize('NFKC').replace(/\s/g, '') !== String(document.fields[key]).normalize('NFKC').replace(/\s/g, ''))) throw new ApiError('BANK_INFORMATION_MISMATCH', '文件與先前提供的銀行資訊不一致，請確認手動資訊或由專員協助。', 422, false);
      const allowed = getJourneyDefinition(current.serviceType)?.documentTypes ?? ['boarding_pass', 'delay_certificate'];
      if (!allowed.includes(document.documentType)) throw new ApiError('DOCUMENT_SERVICE_MISMATCH', '文件類型與目前服務需求不同，請重新選擇。', 422, true);
      if (current.documents.find(doc => doc.documentType === document.documentType)?.id !== initial.documents.find(doc => doc.documentType === document.documentType)?.id) throw new ApiError('JOURNEY_STALE', '同一份文件已更新，這次分析未套用，請確認目前資料。', 409, false);
      for (const work of pending.get(id) ?? []) if (work.operation === document.documentType || work.operation === 'intent') work.invalidated = true;
      const documents = [...current.documents.filter(doc => doc.documentType !== document.documentType), document];
      const journey = save({ ...current, documents, confirmed: false });
      const verified = journey.documents.find(doc => doc.id === document.id)?.status === 'verified';
      if (verified && journey.manualDocumentInformation?.some(item => item.documentType === document.documentType)) {
        journey.manualDocumentInformation = journey.manualDocumentInformation.filter(item => item.documentType !== document.documentType);
        repository.save(ServiceJourneySchema.parse(journey));
      }
      return { document: journey.documents.find(doc => doc.id === document.id), journey, readinessChange: { before: current.readiness, after: journey.readiness } };
    },
    removeDocument(id, documentId) {
      const current = get(id);
      if (!current.documents.some(doc => doc.id === documentId)) throw new ApiError('DOCUMENT_NOT_FOUND', '找不到此文件。', 404, false);
      invalidatePending(id);
      return save({ ...current, documents: current.documents.filter(doc => doc.id !== documentId), confirmed: false });
    },
    review(id) {
      const current = get(id);
      editable(current);
      if (current.nextAction.type !== 'REVIEW_INFORMATION' && current.currentStage !== 'READY_TO_PROCEED') throw new ApiError('REVIEW_NOT_READY', '請先補齊並確認必要文件。', 409, false);
      if (current.currentStage === 'READY_TO_PROCEED') return current;
      invalidatePending(id);
      return save({ ...current, confirmed: true });
    },
    handoffSummary(id) {
      const journey = get(id);
      return { issue: journey.title, summary: journey.summary, collected: journey.requirements.filter(r => r.status === 'verified').map(r => r.name), missing: journey.requirements.filter(r => r.required && r.status !== 'verified').map(r => r.name), reason: journey.confidence < config.humanReviewThreshold ? '需求辨識信心不足，需要人工確認。' : journey.nextAction.type === 'CONTACT_SPECIALIST' ? '部分資訊或文件需要專員確認。' : '服務條件與最終結果仍須依實際條款及專員審核。', consistencyIssues: journey.consistencyIssues ?? [], sources: journey.sources, provider: journey.provider };
    },
  };
}
