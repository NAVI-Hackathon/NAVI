import { z } from 'zod';
import { DocumentSchema, ServiceJourneySchema, JOURNEY_STATES as STATES } from '../../../../shared/journey.js';
import { serviceLabel, validateUnderstanding } from '../domain/intelligence.js';
import { HOSPITAL_WEIGHTS, findHospitalMention, matchPartnerHospital } from '../../../../shared/hospitalization.js';
import { basicJourneys } from '../mocks/basicJourneys.js';
import { documentFixtures, DOCUMENT_TYPES } from '../mocks/hospitalClaim.js';
import {
  claimApplicationForm, claimByMail, diagnosisRule, hospitalUpload, inpatientDocuments, inpatientDocumentsAnchor, officialSource, passbookRuleAnchor,
  passbookRule, reminders, unionChain,
} from '../content/cardifData.js';

// Local journey engine (both adapters). Produces journeys that validate against the shared
// ServiceJourneySchema. Insurer facts come from content/cardifData.js only.

const DISCLAIMER = '準備完成度代表資料完整度，不代表理賠核准；保障範圍與給付仍依保單條款與保險公司審核為準。';
const CONFIDENCE_FOR_REVIEW = 0.65;
const claimsSource = officialSource(claimByMail.url);

// Readiness mapping (35 → 70 → 90 → 100), see commit message for the rationale.
// Hospitalization rules are owned by the backend (shared/hospitalization.js); the local demo reuses them.
const WEIGHTS = HOSPITAL_WEIGHTS;

const optionalDocs = inpatientDocuments.filter(name => name.includes('依病況'));
const applicationForm = inpatientDocuments.find(name => name.includes('申請書'));
const certificateName = inpatientDocuments.find(name => name.includes('診斷書'));

const destinations = {
  documents: { kind: 'page', path: '/services/claims', anchor: inpatientDocumentsAnchor, label: '查看住院醫療應備文件', source: claimsSource },
  rules: { kind: 'page', path: '/services/claims', anchor: passbookRuleAnchor, label: '查看匯款給付規定', source: claimsSource },
  form: { kind: 'form', path: '/services/forms', anchor: 'form-claim-1-1-1', label: `下載${claimApplicationForm?.name ?? '保險金申請書'}`, source: claimsSource },
  hospitalUpload: { kind: 'entry_point', path: '/services/claims', anchor: 'service-claim-hospital-upload', label: '前往保險理賠醫起通', source: officialSource(hospitalUpload.url) },
  unionChain: { kind: 'entry_point', path: '/services/claims', anchor: 'service-claim-union-chain', label: '前往理賠聯盟鏈', source: officialSource(unionChain.url) },
  mail: { kind: 'page', path: '/services/claims', anchor: 'service-claim-by-mail', label: '查看郵寄申請方式', source: claimsSource },
};
export const claimDestinations = destinations;

function claimContext(story) {
  // Conservative matching: 「榮總」 alone names no specific hospital, so it is never treated as a partner.
  const mentioned = findHospitalMention(story);
  const matchedName = mentioned ? matchPartnerHospital(mentioned) : null;
  const hospital = mentioned ? { mentioned, matchedName, partner: Boolean(matchedName) } : null;
  const partner = Boolean(hospital?.partner);
  return {
    hospital,
    channels: [
      { id: 'hospital_upload', name: '保險理賠醫起通', available: partner, notes: [reminders.hospitalStillNeedsCertificate, reminders.hospitalPartnersOnly], destination: destinations.hospitalUpload },
      { id: 'union_chain', name: '理賠聯盟鏈', available: true, notes: [reminders.unionReturnOriginals, reminders.unionLargeAmount], destination: destinations.unionChain },
      { id: 'mail', name: '郵寄申請', available: true, notes: claimByMail.notes, destination: destinations.mail },
    ],
    reminders: [
      ...(partner ? [`使用醫起通時：${reminders.hospitalStillNeedsCertificate}`] : []),
      `使用理賠聯盟鏈時：${reminders.unionReturnOriginals}`,
      `使用理賠聯盟鏈時：${reminders.unionLargeAmount}`,
    ],
  };
}

const uuid = () => globalThis.crypto.randomUUID();
const now = () => new Date().toISOString();

export function createSession(story, understanding, provider = 'demo') {
  const at = now();
  return { journeyId: uuid(), createdAt: at, updatedAt: at, story: story.trim(), understanding: validateUnderstanding(understanding), provider, documents: [], confirmed: false, handoffRequested: false };
}

export function journeyKind(session) {
  const type = session.understanding.data.serviceType;
  return type === 'hospitalization_claim' ? 'hospital' : basicJourneys[type] ? type : 'unknown';
}
export const supportsDocuments = session => journeyKind(session) === 'hospital';
const touch = session => ({ ...session, updatedAt: now() });

export function applySampleDocument(session, type, { filename, mimeType, size, entryMethod = 'sample' } = {}) {
  if (!supportsDocuments(session) || !documentFixtures[type]) throw new Error('Unsupported document requirement.');
  const fixture = documentFixtures[type];
  // Recognition is mocked: fields always come from the owned fixture, never from file contents.
  const document = DocumentSchema.parse({
    id: uuid(), documentType: type, confidence: fixture.confidence, fields: { ...fixture.fields },
    status: 'verified', matchedRequirements: [type], filename: (filename ?? fixture.sampleName).slice(0, 180),
    mimeType: mimeType ?? fixture.mimeType, size: size ?? fixture.size, source: session.provider === 'live' ? 'live' : 'demo', isMock: true, entryMethod,
  });
  return touch({ ...session, confirmed: false, documents: [...session.documents.filter(d => d.documentType !== type), document] });
}

const text = z.string().trim().min(1).max(60);
export const manualSchemas = {
  diagnosis_certificate: z.object({ patientName: text, hospitalName: text, admissionDate: z.iso.date(), dischargeDate: z.iso.date(), diagnosis: text })
    .strict().refine(f => f.dischargeDate >= f.admissionDate, { message: '出院日期需晚於或等於入院日期' }),
  bank_passbook: z.object({ accountHolder: text, bankName: text, accountLast4: z.string().regex(/^\d{4}$/) }).strict(),
};

export function applyManualDocument(session, type, fields) {
  if (!supportsDocuments(session) || !manualSchemas[type]) throw new Error('Unsupported document requirement.');
  const parsed = manualSchemas[type].parse(fields);
  // ponytail: the shared schema requires file metadata; manual entries carry a placeholder (1 byte, PDF).
  const document = DocumentSchema.parse({
    id: uuid(), documentType: type, confidence: 1, fields: parsed, status: 'verified', matchedRequirements: [type],
    filename: '手動輸入', mimeType: 'application/pdf', size: 1, source: session.provider === 'live' ? 'live' : 'demo', isMock: false, entryMethod: 'manual',
  });
  return touch({ ...session, confirmed: false, documents: [...session.documents.filter(d => d.documentType !== type), document] });
}

export function removeDocument(session, type) {
  return touch({ ...session, confirmed: false, documents: session.documents.filter(d => d.documentType !== type) });
}

const verified = (session, type) => session.documents.some(d => d.documentType === type && d.status === 'verified');
function inpatientInfoComplete(session) {
  const f = session.documents.find(d => d.documentType === 'diagnosis_certificate')?.fields;
  return Boolean(f?.hospitalName && f?.admissionDate && f?.dischargeDate);
}
function hospitalChecks(session) {
  const data = session.understanding.data;
  return {
    incident: Boolean(session.story),
    service: data.serviceType === 'hospitalization_claim',
    diagnosis_certificate: verified(session, 'diagnosis_certificate'),
    inpatient_info: verified(session, 'diagnosis_certificate') && inpatientInfoComplete(session),
    bank_passbook: verified(session, 'bank_passbook'),
    confirmation: session.confirmed,
  };
}
export function readyForReview(session) {
  const c = hospitalChecks(session);
  return c.diagnosis_certificate && c.inpatient_info && c.bank_passbook;
}

export function confirmSession(session) {
  if (!supportsDocuments(session) || !readyForReview(session)) throw new Error('Journey is not ready for review.');
  return touch({ ...session, confirmed: true });
}
export const requestHandoff = session => touch({ ...session, handoffRequested: true });

function hospitalRequirements(session) {
  const checks = hospitalChecks(session);
  const req = (id, name, description) => ({ id, name, description, required: true, status: checks[id] ? 'verified' : 'missing', weight: WEIGHTS[id] });
  return [
    req('incident', '事件資訊', '已整理你描述的住院情況。'),
    req('service', '服務辨識', '已辨識為住院醫療理賠，不代表理賠資格。'),
    req('diagnosis_certificate', certificateName, diagnosisRule),
    req('inpatient_info', '住院資訊', '診斷書上的醫院與住院期間完整。'),
    req('bank_passbook', '存摺影本', passbookRule),
    req('confirmation', '資料確認', `確認辨識出的資料，並填妥${applicationForm}。`),
    ...optionalDocs.map((name, i) => ({ id: `optional_${i + 1}`, name, description: '依病況需要時再準備。', required: false, status: 'missing', weight: 0 })),
  ];
}

function hospitalNextAction(session, partner) {
  if (!verified(session, 'diagnosis_certificate')) {
    return { type: 'UPLOAD_DOCUMENT', target: 'diagnosis_certificate', title: `請上傳${certificateName}`, description: diagnosisRule, destination: destinations.documents };
  }
  if (!inpatientInfoComplete(session)) {
    return { type: 'PROVIDE_INFORMATION', target: 'inpatient_info', title: '請補齊住院資訊', description: '請重新上傳清楚的診斷書，或手動輸入醫院與住院期間。', destination: destinations.documents };
  }
  if (!verified(session, 'bank_passbook')) {
    return { type: 'UPLOAD_DOCUMENT', target: 'bank_passbook', title: '請上傳存摺影本', description: `${passbookRule}。`, destination: destinations.rules };
  }
  if (!session.confirmed) {
    return { type: 'REVIEW_INFORMATION', target: null, title: `確認資料並填寫${applicationForm}`, description: '確認辨識出的資料，並下載保險金申請書填寫簽名。', destination: destinations.form };
  }
  return partner
    ? { type: 'PROCEED_TO_SERVICE', target: 'hospital_upload', title: '透過醫起通申請理賠', description: `你住院的醫院是醫起通合作醫院。${reminders.hospitalStillNeedsCertificate}。`, destination: destinations.hospitalUpload }
    : { type: 'PROCEED_TO_SERVICE', target: 'union_chain', title: '透過理賠聯盟鏈申請', description: `${reminders.unionReturnOriginals}。`, destination: destinations.unionChain };
}

function hospitalStage(session) {
  if (session.understanding.data.confidence < CONFIDENCE_FOR_REVIEW || session.handoffRequested) return STATES.HUMAN_REVIEW;
  if (!readyForReview(session)) return STATES.EVIDENCE_COLLECTION;
  return session.confirmed ? STATES.READY_TO_PROCEED : STATES.READY_FOR_REVIEW;
}

/** Session → { journey, context }. journey validates against the shared ServiceJourneySchema. */
export function toSnapshot(session) {
  const kind = journeyKind(session);
  const { data, meta } = session.understanding;
  const base = {
    id: session.journeyId, serviceType: data.serviceType, summary: data.summary, confidence: data.confidence,
    extractedData: data.extractedData, documents: session.documents,
    conversation: [{ role: 'user', message: session.story, createdAt: session.createdAt }],
    sources: [], confirmed: session.confirmed, provider: session.provider,
    createdAt: session.createdAt, updatedAt: session.updatedAt, disclaimer: DISCLAIMER,
  };
  let journey;
  if (kind === 'hospital') {
    const context = claimContext(session.story);
    const requirements = hospitalRequirements(session);
    const currentStage = hospitalStage(session);
    journey = {
      ...base, title: serviceLabel(data.serviceType), supported: true, currentStage,
      readiness: requirements.reduce((sum, r) => sum + (r.status === 'verified' ? r.weight : 0), 0),
      requirements,
      nextAction: currentStage === STATES.HUMAN_REVIEW
        ? { type: 'CONTACT_SPECIALIST', target: null, title: '轉由專員協助', description: '部分資訊需要專員確認，NAVI 已整理好你的描述與文件。' }
        : hospitalNextAction(session, context.hospital?.partner),
      claimContext: context,
      officialSources: [claimsSource],
    };
  } else {
    const basic = basicJourneys[meta.outcome === 'human_review' ? 'unknown' : kind];
    journey = {
      ...base, title: basic === basicJourneys.unknown && kind !== 'unknown' ? serviceLabel(data.serviceType) : basic.title, supported: false,
      currentStage: meta.outcome === 'human_review' || kind === 'unknown' || session.handoffRequested ? STATES.HUMAN_REVIEW : STATES.SERVICE_IDENTIFIED,
      readiness: 0, requirements: basic.requirements, nextAction: basic.nextAction,
      officialSources: basic.nextAction.destination ? [basic.nextAction.destination.source] : [],
    };
  }
  return {
    journey: ServiceJourneySchema.parse(journey),
    context: { kind, story: session.story, source: meta.source, handoffRequested: session.handoffRequested },
  };
}

const StoredSession = z.object({
  v: z.literal(3), journeyId: z.string().uuid(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  story: z.string().min(1).max(2000), understanding: z.unknown(), provider: z.enum(['demo', 'live']),
  documents: z.array(DocumentSchema).max(DOCUMENT_TYPES.length), confirmed: z.boolean(), handoffRequested: z.boolean(),
});

export function serializeSession(session) {
  return JSON.stringify({ v: 3, ...session });
}

/** Returns null for anything that does not validate — a stale or tampered tab simply starts over. */
export function restoreSession(raw) {
  try {
    const stored = StoredSession.parse(JSON.parse(raw));
    const session = { ...stored, understanding: validateUnderstanding(stored.understanding) };
    delete session.v;
    if (session.documents.some(d => !DOCUMENT_TYPES.includes(d.documentType))) return null;
    if (session.confirmed && !readyForReview(session)) return null;
    toSnapshot(session);
    return session;
  } catch {
    return null;
  }
}
