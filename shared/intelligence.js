import { z } from 'zod';

export const MAX_MESSAGE_LENGTH = 2000;
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.65;
export const intentTypes = ['service_request', 'knowledge_query', 'unknown'];
export const serviceTypes = ['flight_delay', 'vehicle_accident', 'payment_method_change', 'policy_change', 'policy_information', 'hospitalization_claim', 'unknown'];
// Service types that open a full NAVI journey (others get intent recognition only).
export const SUPPORTED_SERVICE_TYPES = ['flight_delay', 'hospitalization_claim'];
const field = z.string().trim().min(1).max(120).nullable();
export const IntentDataSchema = z.object({
  intent: z.enum(intentTypes),
  serviceType: z.enum(serviceTypes),
  confidence: z.number().finite().min(0).max(1),
  summary: z.string().trim().min(1).max(300),
  extractedData: z.object({
    origin: field,
    destination: field,
    delayMinutes: z.number().int().min(0).max(525600).nullable(),
    incidentDate: z.iso.date().nullable(),
    hospitalName: field.optional(),
    patientName: field.optional(),
    admissionDate: z.iso.date().nullable().optional(),
    dischargeDate: z.iso.date().nullable().optional(),
    reportedInpatientDays: z.number().int().min(1).max(3660).nullable().optional(),
  }).strict(),
}).strict();

// Business routing is owned by NAVI. Confidence is a model estimate, not calibrated probability.
export function intentDisposition(data, threshold = DEFAULT_CONFIDENCE_THRESHOLD) {
  if (data.intent === 'unknown' || data.serviceType === 'unknown') return 'clarification';
  if (data.confidence < threshold) return 'human_review';
  return data.intent === 'service_request' && SUPPORTED_SERVICE_TYPES.includes(data.serviceType) ? 'supported' : 'preview';
}

export const UnderstandingSchema = z.object({
  success: z.literal(true),
  data: IntentDataSchema,
  meta: z.object({
    source: z.enum(['gemini', 'demo_fallback']),
    outcome: z.enum(['supported', 'preview', 'clarification', 'human_review']),
    confidenceThreshold: z.number().finite().min(0).max(1),
  }).strict(),
}).strict().refine(result => result.meta.outcome === intentDisposition(result.data, result.meta.confidenceThreshold));
