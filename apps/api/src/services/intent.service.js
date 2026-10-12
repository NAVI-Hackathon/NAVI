import { intentDisposition } from '../../../../shared/intelligence.js';
import { normalizeIntent } from '../schemas/intent.schema.js';
import { requestValidatedAI } from './providerRequest.js';

export async function understandIntent(message, { provider, config, signal }) {
  const data = await requestValidatedAI(async combined => normalizeIntent(await provider.understandIntent(message, combined), message), { config, signal });
  return { success: true, data, meta: { source: provider.mode === 'demo' ? 'demo_fallback' : 'gemini', outcome: intentDisposition(data, config.confidenceThreshold), confidenceThreshold: config.confidenceThreshold } };
}
