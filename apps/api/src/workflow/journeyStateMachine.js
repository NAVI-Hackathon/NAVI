import { deriveServiceWorkflow } from '../services/serviceWorkflows.js';
import rules from '../../../../knowledge/claims.json' with { type: 'json' };
import { JOURNEY_STATES as STATES } from '../../../../shared/journey.js';
import { getJourneyDefinition } from '../services/knowledgeService.js';
import { documentVerified, travelInformationComplete } from '../services/documentValidationService.js';
import { checkEvidenceConsistency } from '../services/evidenceConsistencyService.js';
import { hospitalClaimContext, hospitalDestinations, calculateStay } from '../../../../shared/hospitalization.js';
import { officialSource, claimsUrl } from '../../../../shared/cardif.js';

const weights = new Map(rules.readiness.map(rule => [rule.id, rule.weight]));
export function calculateReadiness(journey) {
  return journey.supported ? journey.requirements.reduce((total, requirement) => total + (requirement.status === 'verified' ? requirement.weight : 0), 0) : 0;
}
export function determineNextAction(journey, config) {
  const action = (type, target, title, description) => ({ type, target, title, description });
  if (journey.serviceType === 'unknown') return action('PROVIDE_INFORMATION', 'incident', '請再描述你的情況', '可以再說明目前想處理的事情，或發生了什麼嗎？');
  const hospital = journey.serviceType === 'hospitalization_claim';
  if (journey.confidence < (hospital ? config.confidenceThreshold : config.journeyConfidenceThreshold) || journey.documents.some(doc => doc.status === 'needs_review')) return action('CONTACT_SPECIALIST', null, '轉由專員協助', '部分資料需要進一步確認，已整理好資訊供專員接續處理。');
  if (!journey.supported) return action('NONE', null, 'NAVI 已辨識你的需求', '目前 Prototype 尚未開放這項服務的完整旅程。');
  if (hospital) {
    for (const [type, destination] of [['diagnosis_certificate', hospitalDestinations.documents], ['bank_passbook', hospitalDestinations.rules]]) {
      if (!journey.documents.some(doc => doc.documentType === type && doc.status === 'verified')) {
        const requirement = journey.requirements.find(r => r.id === type);
        return { ...action('UPLOAD_DOCUMENT', type, `請上傳${requirement.name}`, requirement.description), destination };
      }
    }
    if (!journey.confirmed) return { ...action('REVIEW_INFORMATION', null, '確認資料並填妥保險金申請書', '確認整理的資料，不會自動送出申請。'), destination: hospitalDestinations.form };
    // The seed permits inpatient proof generally, but 醫起通 explicitly requires a diagnosis certificate.
    const partner = journey.claimContext?.hospital?.partner && journey.documents.some(doc => doc.documentType === 'diagnosis_certificate' && doc.fields.certificateKind === 'diagnosis_certificate');
    return { ...action('PROCEED_TO_SERVICE', partner ? 'hospital_upload' : 'union_chain', partner ? '查看保險理賠醫起通' : '查看理賠聯盟鏈或郵寄方式', '資料初步準備完成，僅提供管道資訊；適用條件仍需確認，不代表保障適用、理賠核准或已送件。'), destination: partner ? hospitalDestinations.hospitalUpload : hospitalDestinations.unionChain };
  }
  for (const type of ['boarding_pass', 'delay_certificate']) if (!journey.documents.some(doc => doc.documentType === type && doc.status === 'verified')) return action('UPLOAD_DOCUMENT', type, type === 'boarding_pass' ? '請上傳登機證' : '請上傳航空公司延誤證明', type === 'boarding_pass' ? '用於確認旅客與航班資訊。' : '這份文件可協助確認實際延誤時間。');
  if (!journey.requirements.some(r => r.id === 'travel' && r.status === 'verified')) return action('PROVIDE_INFORMATION', 'travel', '請補齊旅行資訊', '請重新上傳包含旅客姓名、航班、航線與日期的完整登機證。');
  return journey.confirmed ? action('PROCEED_TO_SERVICE', null, '前往服務', '資料已準備完成，可接續既有服務；這不代表理賠核准或已送出申請。') : action('REVIEW_INFORMATION', null, '確認案件資料', '請確認航班資訊與已提供的文件。');
}
export function deriveJourney(journey, config) {
  if (config.productMode && journey.workflowId) return deriveServiceWorkflow(journey, config);
  const definition = getJourneyDefinition(journey.serviceType);
  const documents = journey.documents.map(document => {
    const verified = Boolean(definition && (definition.documentTypes ?? ['boarding_pass', 'delay_certificate']).includes(document.documentType) && documentVerified(document, config.journeyConfidenceThreshold));
    return { ...document, verification: { scope: 'prototype_field_consistency', authenticity: 'not_assessed', eligibility: 'not_assessed' }, status: verified ? 'verified' : 'needs_review', matchedRequirements: verified ? [document.documentType] : [] };
  });
  const consistencyIssues = checkEvidenceConsistency(documents, journey.extractedData);
  for (const issue of consistencyIssues) {
    // Cross-document conflict leaves the original boarding evidence usable, while the
    // conflicting certificate needs review. A conflict with the incident flags that file.
    const affected = issue.documentIds.length > 1 ? [issue.documentIds.at(-1)] : issue.documentIds;
    for (const doc of documents) if (affected.includes(doc.id)) { doc.status = 'needs_review'; doc.matchedRequirements = []; }
  }
  journey = { ...journey, documents, consistencyIssues };
  const verified = type => journey.documents.some(doc => doc.documentType === type && doc.status === 'verified');
  const boarding = verified('boarding_pass');
  const delay = verified('delay_certificate');
  const travel = boarding && travelInformationComplete(documents.find(doc => doc.documentType === 'boarding_pass'));
  const hospital = journey.serviceType === 'hospitalization_claim';
  const diagnosis = verified('diagnosis_certificate');
  const inpatient = diagnosis && calculateStay(documents.find(doc => doc.documentType === 'diagnosis_certificate').fields).days !== null;
  const passbook = verified('bank_passbook');
  const complete = hospital ? diagnosis && inpatient && passbook : travel && boarding && delay;
  const checks = { incident: journey.conversation.some(entry => entry.role === 'user' && entry.message.trim()), service: journey.serviceType !== 'unknown', travel, boarding_pass: boarding, delay_certificate: delay, diagnosis_certificate: diagnosis, inpatient_info: inpatient, bank_passbook: passbook, confirmation: complete && journey.confirmed };
  const needsReview = journey.documents.some(doc => doc.status === 'needs_review');
  const requirements = (definition?.requirements ?? []).map(requirement => ({ ...requirement, weight: requirement.weight ?? weights.get(requirement.id), status: checks[requirement.id] ? 'verified' : journey.documents.some(doc => doc.documentType === requirement.id && doc.status === 'needs_review') ? 'needs_review' : 'missing' }));
  const low = journey.confidence < (hospital ? config.confidenceThreshold : config.journeyConfidenceThreshold);
  const currentStage = journey.serviceType === 'unknown' ? STATES.INCIDENT_IDENTIFIED : needsReview || hospital && low || journey.confidence < config.humanReviewThreshold ? STATES.HUMAN_REVIEW : low || !definition ? STATES.SERVICE_IDENTIFIED : complete ? journey.confirmed ? STATES.READY_TO_PROCEED : STATES.READY_FOR_REVIEW : STATES.EVIDENCE_COLLECTION;
  const derived = { ...journey, supported: Boolean(definition), requirements, currentStage, ...(hospital ? { claimContext: hospitalClaimContext(journey.extractedData, documents), officialSources: [officialSource(claimsUrl)] } : {}) };
  return { ...derived, readiness: calculateReadiness(derived), nextAction: determineNextAction(derived, config) };
}
