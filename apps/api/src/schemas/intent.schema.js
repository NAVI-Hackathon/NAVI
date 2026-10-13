import { redactIdentifiers } from '../utils/privacy.js';
import { z } from 'zod';
import { IntentDataSchema, MAX_MESSAGE_LENGTH } from '../../../../shared/intelligence.js';
import { hasNegatedHospitalization } from '../../../../shared/hospitalization.js';

export const HOSPITAL_SUMMARY = '使用者回報住院情況，希望了解醫療理賠申請流程。';
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
  for (const key of ['patientName', 'hospitalName']) {
    const value = parsed.extractedData[key];
    if (value && redactIdentifiers(value) !== value) parsed.extractedData[key] = null;
  }
  // Medical/financial conclusions must not leak through the model's free-text summary.
  if (parsed.serviceType === 'hospitalization_claim') parsed.summary = parsed.intent === 'knowledge_query' ? '使用者希望了解住院醫療理賠相關資訊。' : HOSPITAL_SUMMARY;
  return IntentDataSchema.parse(parsed);
}
