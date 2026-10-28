import { z } from 'zod';
import { IntentDataSchema, MAX_MESSAGE_LENGTH, serviceTypes } from './intelligence.js';
import { isTrustedDestination } from './cardif.js';

export const JOURNEY_STATES = Object.freeze({ NEW: 'NEW', INCIDENT_IDENTIFIED: 'INCIDENT_IDENTIFIED', SERVICE_IDENTIFIED: 'SERVICE_IDENTIFIED', EVIDENCE_COLLECTION: 'EVIDENCE_COLLECTION', READY_FOR_REVIEW: 'READY_FOR_REVIEW', HUMAN_REVIEW: 'HUMAN_REVIEW', READY_TO_PROCEED: 'READY_TO_PROCEED' });
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
export const DocumentClockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();
const departureTime = z.union([DocumentClockTimeSchema.unwrap(), z.iso.datetime({ offset: true })]).nullable();
const text = z.string().trim().min(1).max(120).nullable();
export const DocumentAnalysisSchema = z.discriminatedUnion('documentType', [
  z.object({ documentType: z.literal('boarding_pass'), confidence: z.number().finite().min(0).max(1), fields: z.object({ passengerName: text, flightNumber: text, origin: text, destination: text, departureDate: z.iso.date().nullable(), scheduledDeparture: departureTime.optional() }).strict() }).strict(),
  z.object({ documentType: z.literal('delay_certificate'), confidence: z.number().finite().min(0).max(1), fields: z.object({ flightNumber: text, scheduledDeparture: departureTime, actualDeparture: departureTime, departureDate: z.iso.date().nullable().optional(), actualDepartureDate: z.iso.date().nullable().optional(), passengerName: text.optional(), origin: text.optional(), destination: text.optional(), delayMinutes: z.number().int().min(0).max(525600).nullable().optional() }).strict() }).strict(),
  z.object({ documentType: z.literal('diagnosis_certificate'), confidence: z.number().finite().min(0).max(1), fields: z.object({ patientName: text, hospitalName: text, admissionDate: z.iso.date().nullable(), dischargeDate: z.iso.date().nullable(), diagnosis: text, certificateKind: z.enum(['diagnosis_certificate', 'hospitalization_proof']).nullable().optional(), reportedInpatientDays: z.number().int().min(1).max(3660).nullable().optional(), inpatientDays: z.number().int().min(1).max(3660).nullable().optional(), inpatientDaysSource: z.enum(['dates', 'printed_days']).nullable().optional() }).strict() }).strict(),
  z.object({ documentType: z.literal('bank_passbook'), confidence: z.number().finite().min(0).max(1), fields: z.object({ accountHolder: text, bankName: text, accountLast4: z.string().regex(/^\d{4}$/).nullable() }).strict() }).strict(),
  z.object({ documentType: z.literal('unknown'), confidence: z.number().finite().min(0).max(1), fields: z.object({}).strict() }).strict(),
]);
export const RequirementSchema = z.object({ id: z.string(), name: z.string(), description: z.string(), required: z.boolean(), status: z.enum(['missing', 'uploaded', 'verified', 'needs_review']), weight: z.number().int().min(0).max(100) }).strict();
const PrototypeSourceSchema = z.object({ id: z.string(), title: z.string(), section: z.string(), type: z.enum(['prototype_guide', 'prototype_faq']), isMock: z.literal(true), url: z.null() }).strict();
// Where a step lives on the (mock) insurer website. path is always an internal mock-site path;
// only source.url may point at the real insurer page (opened in a new tab, never fetched).
export const OfficialSourceSchema = z.object({ url: z.url().regex(/^https:\/\/life\.cardif\.com\.tw\//), title: z.string().min(1).max(80), retrievedAt: z.iso.date() }).strict();
export const NavigationTargetSchema = z.object({
  kind: z.enum(['page', 'form', 'faq', 'entry_point']),
  path: z.string().regex(/^\/(?!\/)[a-z0-9/_-]*$/),
  anchor: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable(),
  label: z.string().min(1).max(40),
  source: OfficialSourceSchema,
}).strict().refine(isTrustedDestination, { message: '導覽目標不在可信官網資料對照中。' });
export const KnowledgeSourceSchema = z.union([PrototypeSourceSchema, z.object({
  id: z.string(), sourceId: z.string(), title: z.string(), section: z.string(), type: z.literal('public_site_snapshot'),
  isMock: z.literal(false), url: z.url(), sourceUrl: z.url(), retrievedAt: z.iso.date(), navigationDestination: NavigationTargetSchema,
}).strict().refine(source => source.id === source.sourceId && source.url === source.sourceUrl && source.sourceUrl === source.navigationDestination.source.url && source.retrievedAt === source.navigationDestination.source.retrievedAt, { message: '來源欄位與導覽來源不一致。' })]);
export const NextActionSchema = z.object({ type: z.enum(['UPLOAD_DOCUMENT', 'PROVIDE_INFORMATION', 'REVIEW_INFORMATION', 'CONTACT_SPECIALIST', 'PROCEED_TO_SERVICE', 'NONE']), target: z.string().nullable(), title: z.string(), description: z.string(), destination: NavigationTargetSchema.optional() }).strict();
export const DocumentVerificationSchema = z.object({ scope: z.literal('prototype_field_consistency'), authenticity: z.literal('not_assessed'), eligibility: z.literal('not_assessed') }).strict();
export const HospitalStaySchema = z.object({ calendarDays: z.number().int().min(1).max(3660).nullable(), nights: z.number().int().min(0).max(3659).nullable(), reportedDays: z.number().int().min(1).max(3660).nullable(), requiresConfirmation: z.boolean() }).strict();
const documentMetadata = z.object({ id: z.string().uuid(), status: z.enum(['uploaded', 'verified', 'needs_review']), matchedRequirements: z.array(z.string()), filename: z.string().max(180), mimeType: z.enum(DOCUMENT_MIME_TYPES), size: z.number().int().positive().max(MAX_DOCUMENT_BYTES), source: z.enum(['demo', 'live']), isMock: z.boolean(), entryMethod: z.enum(['upload', 'sample', 'manual']).optional(), verification: DocumentVerificationSchema.optional(), stay: HospitalStaySchema.optional(), requiresRevalidation: z.boolean().optional() }).strict();
export const DocumentSchema = z.discriminatedUnion('documentType', DocumentAnalysisSchema.options.map(schema => schema.extend(documentMetadata.shape)));
export const ConversationSchema = z.object({ role: z.enum(['user', 'assistant']), message: z.string().max(MAX_MESSAGE_LENGTH), createdAt: z.iso.datetime() }).strict();
export const ConsistencyIssueSchema = z.object({ type: z.enum(['FLIGHT_NUMBER_MISMATCH', 'DEPARTURE_DATE_MISMATCH', 'ORIGIN_MISMATCH', 'DESTINATION_MISMATCH', 'PASSENGER_NAME_MISMATCH', 'HOSPITAL_NAME_MISMATCH', 'ADMISSION_DATE_MISMATCH', 'DISCHARGE_DATE_MISMATCH', 'INPATIENT_DAYS_MISMATCH', 'PATIENT_NAME_MISMATCH']), severity: z.literal('high'), message: z.string(), documentIds: z.array(z.string().uuid()) }).strict();
// Navigation is technical availability; channel conditions and coverage are separate decisions.
export const ChannelEligibilitySchema = z.object({
  status: z.enum(['eligible', 'requires_confirmation', 'ineligible']),
  scope: z.literal('channel_conditions_only'), coverageAssessed: z.literal(false),
  reason: z.string().min(1), sourceIds: z.array(z.string().min(1)).min(1),
  unconfirmedRequirements: z.array(z.string().min(1)),
}).strict().refine(value => value.status === 'eligible' ? value.unconfirmedRequirements.length === 0 : value.status !== 'requires_confirmation' || value.unconfirmedRequirements.length > 0, { message: '管道資格狀態與尚待確認條件不一致。' });
export const ClaimChannelSchema = z.object({ id: z.enum(['hospital_upload', 'union_chain', 'mail']), name: z.string(), available: z.boolean(), navigationAvailable: z.boolean().optional(), eligibility: ChannelEligibilitySchema.optional(), notes: z.array(z.string()), destination: NavigationTargetSchema }).strict();
export const ClaimContextSchema = z.object({
  hospital: z.object({ mentioned: z.string(), matchedName: z.string().nullable(), partner: z.boolean() }).nullable(),
  inpatient: z.object({ admissionDate: z.iso.date().nullable(), dischargeDate: z.iso.date().nullable(), days: z.number().int().min(1).max(3660).nullable(), source: z.enum(['dates', 'printed_days', 'user_reported']).nullable() }).strict().optional(),
  channels: z.array(ClaimChannelSchema),
  reminders: z.array(z.string()),
}).strict();
// Manual statements are stored separately from evidence; no confidence or verified status accepted.
const manualText = z.string().trim().min(1).max(120).nullable().optional();
const manualDate = z.iso.date().nullable().optional();
export const ManualDocumentInformationRequestSchema = z.discriminatedUnion('documentType', [
  z.object({ documentType: z.literal('diagnosis_certificate'), fields: z.object({ hospitalName: manualText, admissionDate: manualDate, dischargeDate: manualDate, reportedInpatientDays: z.number().int().min(1).max(3660).nullable().optional() }).strict() }).strict(),
  z.object({ documentType: z.literal('bank_passbook'), fields: z.object({ bankName: manualText, accountLast4: z.string().regex(/^\d{4}$/).nullable().optional() }).strict() }).strict(),
]).refine(value => Object.values(value.fields).some(v => v !== null && v !== undefined), { message: '請至少填寫一項文件資訊。' });
export const ManualDocumentInformationSchema = z.object({
  documentType: z.enum(['diagnosis_certificate', 'bank_passbook']), source: z.literal('manual'), status: z.literal('needs_review'),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])), updatedAt: z.iso.datetime(),
}).strict().refine(value => ManualDocumentInformationRequestSchema.safeParse({ documentType: value.documentType, fields: value.fields }).success);
export const ServiceJourneySchema = z.object({
  id: z.string().uuid(), serviceType: z.enum(serviceTypes), title: z.string(), summary: z.string().max(300), confidence: z.number().min(0).max(1), currentStage: z.enum(Object.values(JOURNEY_STATES)), readiness: z.number().int().min(0).max(100),
  extractedData: IntentDataSchema.shape.extractedData, requirements: z.array(RequirementSchema), documents: z.array(DocumentSchema), conversation: z.array(ConversationSchema), nextAction: NextActionSchema, sources: z.array(KnowledgeSourceSchema),
  consistencyIssues: z.array(ConsistencyIssueSchema).optional(), confirmed: z.boolean(), supported: z.boolean(), provider: z.enum(['demo', 'live', 'provided']), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), disclaimer: z.string(),
  manualDocumentInformation: z.array(ManualDocumentInformationSchema).max(2).optional(),
  claimContext: ClaimContextSchema.optional(), officialSources: z.array(OfficialSourceSchema).optional(),
}).strict();
export const CreateJourneyRequestSchema = z.object({ message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH), intentResult: IntentDataSchema.optional() }).strict();
export const ReviewRequestSchema = z.object({ confirmed: z.literal(true) }).strict();
