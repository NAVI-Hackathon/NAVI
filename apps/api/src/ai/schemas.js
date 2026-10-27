import { z } from 'zod';
import { IntentDataSchema, intentTypes, serviceTypes } from '../../../../shared/intelligence.js';
import { DocumentFieldConfidenceSchema, DocumentAnalysisSchema, DocumentClockTimeSchema } from '../../../../shared/journey.js';
import { normalizeIntent } from '../schemas/intent.schema.js';
import { hasNegatedHospitalization } from '../../../../shared/hospitalization.js';

const confidence = z.number().finite();
const text = z.string().trim().min(1).max(120).nullable();
export const GeminiIntentSchema = IntentDataSchema.extend({
  intent: z.string().trim().min(1).max(80), serviceType: z.string().trim().min(1).max(80), confidence: confidence.default(0),
  missingInformation: z.array(z.string().max(120)).max(20).optional(),
});
export const intentJsonSchema = z.toJSONSchema(IntentDataSchema.extend({ missingInformation: z.array(z.string().max(120)).max(20).optional() }));
const aliases = {
  service_discovery: 'service_request', claim: 'service_request', service_navigation: 'service_request',
  information_query: 'knowledge_query', car_accident: 'vehicle_accident', flight_delay_claim: 'flight_delay', payment_change: 'payment_method_change',
  hospital_claim: 'hospitalization_claim', hospitalization: 'hospitalization_claim', medical_claim: 'hospitalization_claim', inpatient_claim: 'hospitalization_claim',
};
const canonical = (value, values) => {
  const key = value.toLowerCase().replace(/[\s-]+/g, '_');
  const mapped = aliases[key] ?? key;
  return values.includes(mapped) ? mapped : 'unknown';
};
export function normalizeGeminiIntent(raw) {
  const { missingInformation, ...data } = GeminiIntentSchema.parse(raw);
  data.intent = canonical(data.intent, intentTypes);
  data.serviceType = canonical(data.serviceType, serviceTypes);
  if (/^medical[\s_-]*claim$/i.test(raw.serviceType) && (!/住院|inpatient|hospitali[sz]/i.test(data.summary) || hasNegatedHospitalization(data.summary) || /outpatient/i.test(data.summary))) data.serviceType = 'unknown';
  data.confidence = Math.max(0, Math.min(1, data.confidence));
  // A recognized class without travel details is still actionable; never invent those details.
  if (data.serviceType === 'unknown' || data.intent === 'unknown') data.confidence = Math.min(data.confidence, 0.4);
  else if (data.serviceType === 'flight_delay') {
    const provided = ['origin', 'destination', 'delayMinutes', 'incidentDate'].filter(key => data.extractedData[key] !== null).length;
    data.confidence = Math.max(0, data.confidence - (4 - provided) * 0.02);
  }
  data.confidence = Math.round(data.confidence * 1000) / 1000;
  return normalizeIntent(data);
}
export const GeminiDocumentSchema = z.object({
  documentType: z.enum(['boarding_pass', 'delay_certificate', 'diagnosis_certificate', 'bank_passbook', 'unknown']), confidence, fieldConfidence:DocumentFieldConfidenceSchema.optional(),
  fields: z.object({ passengerName: text, flightNumber: text, origin: text, destination: text,
    departureDate: z.iso.date().nullable(), actualDepartureDate: z.iso.date().nullable(),
    scheduledDeparture: DocumentClockTimeSchema,
    actualDeparture: DocumentClockTimeSchema,
    patientName: text.optional(), hospitalName: text.optional(), admissionDate: z.iso.date().nullable().optional(), dischargeDate: z.iso.date().nullable().optional(),
    certificateKind: z.enum(['diagnosis_certificate', 'hospitalization_proof']).nullable().optional(),
    reportedInpatientDays: z.number().int().min(1).max(3660).nullable().optional(),
    accountHolder: text.optional(), bankName: text.optional(), accountLast4: z.string().regex(/^\d{4}$/).nullable().optional(),
  }).strict(),
}).strict();
export const documentJsonSchema = z.toJSONSchema(GeminiDocumentSchema.extend({ confidence: z.number().min(0).max(1) }));
export function normalizeGeminiDocument(raw) {
  // Keep the existing public enum; accept the unambiguous alternative spelling only at provider intake.
  if (raw?.fields?.certificateKind === 'hospitalization_certificate') raw = { ...raw, fields: { ...raw.fields, certificateKind: 'hospitalization_proof' } };
  const parsed = GeminiDocumentSchema.parse(raw);
  parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
  if (parsed.documentType === 'unknown') return { documentType: 'unknown', confidence: Math.min(parsed.confidence, 0.4), fields: {} };
  if (parsed.documentType === 'diagnosis_certificate') return DocumentAnalysisSchema.parse({ ...parsed, fields: {
    patientName: parsed.fields.patientName ?? null, hospitalName: parsed.fields.hospitalName ?? null, admissionDate: parsed.fields.admissionDate ?? null, dischargeDate: parsed.fields.dischargeDate ?? null,
    diagnosis: null, certificateKind: parsed.fields.certificateKind ?? null, reportedInpatientDays: parsed.fields.reportedInpatientDays ?? null,
  } });
  if (parsed.documentType === 'bank_passbook') return DocumentAnalysisSchema.parse({ ...parsed, fields: { accountHolder: parsed.fields.accountHolder ?? null, bankName: parsed.fields.bankName ?? null, accountLast4: parsed.fields.accountLast4 ?? null } });
  const allowed = parsed.documentType === 'boarding_pass'
    ? ['passengerName', 'flightNumber', 'origin', 'destination', 'departureDate', 'scheduledDeparture']
    : ['passengerName', 'flightNumber', 'origin', 'destination', 'departureDate', 'actualDepartureDate', 'scheduledDeparture', 'actualDeparture'];
  return DocumentAnalysisSchema.parse({ ...parsed, fields: Object.fromEntries(allowed.map(key => [key, parsed.fields[key]])) });
}
export const GroundedAnswerSchema = z.object({ answer: z.string().trim().min(1).max(2000), confidence: z.number().finite().min(0).max(1), supported: z.boolean(), sourceIds: z.array(z.string().min(1).max(120)).max(10) }).strict();
export const HandoffSelectionSchema = z.object({ factIds: z.array(z.string().max(120)).min(1).max(30) }).strict();
