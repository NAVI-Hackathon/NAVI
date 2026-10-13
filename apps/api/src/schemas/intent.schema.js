import { z } from 'zod';
import { IntentDataSchema, MAX_MESSAGE_LENGTH } from '../../../../shared/intelligence.js';
import { hasNegatedHospitalization } from '../../../../shared/hospitalization.js';

export const RequestSchema = z.object({ message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) }).strict();
// Out-of-range confidence is clamped; absent confidence safely becomes zero. Wrong types still fail.
export const ProviderIntentSchema = IntentDataSchema.extend({ confidence: z.number().finite().default(0) });
export const providerJsonSchema = z.toJSONSchema(IntentDataSchema);
export function normalizeIntent(raw, message = '') {
  const parsed = ProviderIntentSchema.parse(raw);
  parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
  if (parsed.serviceType === 'hospitalization_claim' && hasNegatedHospitalization(message)) {
    parsed.intent = 'unknown'; parsed.serviceType = 'unknown'; parsed.confidence = Math.min(parsed.confidence, 0.4);
  }
  if (parsed.intent === 'unknown' || parsed.serviceType === 'unknown') {
    parsed.intent = 'unknown'; parsed.serviceType = 'unknown';
    parsed.confidence = Math.min(parsed.confidence, 0.4);
    parsed.extractedData = { origin: null, destination: null, delayMinutes: null, incidentDate: null };
  }
  return IntentDataSchema.parse(parsed);
}
