import { randomUUID } from 'node:crypto';
import { ServiceJourneySchema } from '../../../../shared/journey.js';
import { MAX_MESSAGE_LENGTH } from '../../../../shared/intelligence.js';
import { understandIntent } from './intent.service.js';
import { normalizeIntent } from '../schemas/intent.schema.js';
import { getJourneyDefinition, getSources } from './knowledgeService.js';
import { deriveJourney } from '../workflow/journeyStateMachine.js';
import { analyzeDocument } from './documentService.js';
import { ApiError } from '../middleware/errorHandler.js';
import { findHospitalMention, reportedStayDays } from '../../../../shared/hospitalization.js';

const titles = { hospitalization_claim: '住院醫療理賠', vehicle_accident: '車輛事故', payment_method_change: '更改繳費方式', policy_change: '保單變更', policy_information: '保單資訊', unknown: '需要補充說明' };
// Do not persist common identifiers even in transient demo conversations. No request body logging.
const redact = text => text.replace(/\b[A-Z][12]\d{8}\b/gi, '[已遮蔽身分證字號]').replace(/\b09\d{2}[- ]?\d{3}[- ]?\d{3}\b/g, '[已遮蔽電話]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[已遮蔽電子郵件]');

export function createJourneyService({ repository, provider, config }) {
  const save = journey => repository.save(ServiceJourneySchema.parse(deriveJourney({ ...journey, updatedAt: new Date().toISOString() }, config)));
  function get(id) {
    const journey = repository.get(id);
    if (!journey) throw new ApiError('JOURNEY_NOT_FOUND', '找不到此案件，可能已過期，請重新開始。', 404, false);
    return journey;
  }
  function editable(journey) {
    if (!journey.supported) throw new ApiError('SERVICE_NOT_SUPPORTED', '目前尚未開放這項服務的完整旅程。', 409, false);
    if (journey.confidence < (journey.serviceType === 'hospitalization_claim' ? config.confidenceThreshold : config.journeyConfidenceThreshold)) throw new ApiError('HUMAN_REVIEW_REQUIRED', '這個情況需要由專員協助確認。', 409, false);
  }
  return {
    get,
    async create({ message, intentResult }, signal) {
      const data = intentResult ? normalizeIntent(intentResult, message) : (await understandIntent(message, { provider, config, signal })).data;
      const definition = getJourneyDefinition(data.serviceType);
      if (data.serviceType === 'hospitalization_claim') {
        // Fill explicit local mentions for clients using the pre-PR schema; never infer dates.
        data.extractedData.hospitalName ??= findHospitalMention(message);
        data.extractedData.reportedInpatientDays ??= reportedStayDays(message);
      }
      const now = new Date().toISOString();
      return save({ id: randomUUID(), serviceType: data.serviceType, title: definition?.title ?? titles[data.serviceType], summary: redact(data.summary).slice(0, ServiceJourneySchema.shape.summary.maxLength), confidence: data.confidence, extractedData: data.extractedData, documents: [], conversation: [{ role: 'user', message: redact(message).slice(0, MAX_MESSAGE_LENGTH), createdAt: now }], confirmed: false, supported: Boolean(definition), provider: intentResult ? 'provided' : provider.mode === 'demo' ? 'demo' : 'live', sources: getSources(definition?.sourceIds ?? []), createdAt: now, disclaimer: definition?.disclaimer ?? '目前僅辨識需求，不提供理賠資格或保障結論。' });
    },
    async addDocument(id, upload, signal) {
      editable(get(id));
      const document = await analyzeDocument(upload, { provider, config, signal });
      // Read again after asynchronous analysis so concurrent uploads retain one another's documents.
      const current = get(id);
      editable(current);
      const allowed = getJourneyDefinition(current.serviceType)?.documentTypes ?? ['boarding_pass', 'delay_certificate'];
      if (!allowed.includes(document.documentType)) throw new ApiError('DOCUMENT_SERVICE_MISMATCH', '文件類型與目前服務需求不同，請重新選擇。', 422, true);
      const documents = [...current.documents.filter(doc => doc.documentType !== document.documentType), document];
      const journey = save({ ...current, documents, confirmed: false });
      return { document: journey.documents.find(doc => doc.id === document.id), journey, readinessChange: { before: current.readiness, after: journey.readiness } };
    },
    removeDocument(id, documentId) {
      const current = get(id);
      if (!current.documents.some(doc => doc.id === documentId)) throw new ApiError('DOCUMENT_NOT_FOUND', '找不到此文件。', 404, false);
      return save({ ...current, documents: current.documents.filter(doc => doc.id !== documentId), confirmed: false });
    },
    review(id) {
      const current = get(id);
      editable(current);
      if (current.nextAction.type !== 'REVIEW_INFORMATION' && current.currentStage !== 'READY_TO_PROCEED') throw new ApiError('REVIEW_NOT_READY', '請先補齊並確認必要文件。', 409, false);
      return save({ ...current, confirmed: true });
    },
    handoffSummary(id) {
      const journey = get(id);
      return { issue: journey.title, summary: journey.summary, collected: journey.requirements.filter(r => r.status === 'verified').map(r => r.name), missing: journey.requirements.filter(r => r.required && r.status !== 'verified').map(r => r.name), reason: journey.confidence < config.humanReviewThreshold ? '需求辨識信心不足，需要人工確認。' : journey.nextAction.type === 'CONTACT_SPECIALIST' ? '部分資訊或文件需要專員確認。' : '服務條件與最終結果仍須依實際條款及專員審核。', consistencyIssues: journey.consistencyIssues ?? [], sources: journey.sources, provider: journey.provider };
    },
  };
}
