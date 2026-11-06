import { ollamaOrigin } from '../ai/ollamaTransport.js';

export const OLLAMA_TEXT_MODEL = 'qwen3:4b-instruct-2507-q4_K_M';
export const OLLAMA_VISION_MODELS = Object.freeze(['qwen3.5:4b', 'qwen3-vl:4b-instruct']);

export function ollamaConfig(env) {
  if (env.ALLOW_PAID_AI === 'true' || (env.HOST && env.HOST !== '127.0.0.1') ||
      (env.AI_MAX_CONCURRENT && Number(env.AI_MAX_CONCURRENT) !== 1)) {
    throw new Error('Ollama requires a private listener, no paid provider and one model generation slot');
  }
  const production = env.NODE_ENV === 'production';
  const ollamaModel = env.OLLAMA_TEXT_MODEL || OLLAMA_TEXT_MODEL;
  const ollamaVisionModel = env.OLLAMA_VISION_MODEL || '';
  if (ollamaModel !== OLLAMA_TEXT_MODEL ||
      (ollamaVisionModel && !OLLAMA_VISION_MODELS.includes(ollamaVisionModel))) {
    throw new Error('Invalid Ollama model selection');
  }
  const origin = env.OLLAMA_BASE_URL || (production ? '' : 'http://127.0.0.1:11434');
  const ollamaBaseUrl = ollamaOrigin(origin, { requireTLS: production });
  const ollamaTls = {
    caPath: env.OLLAMA_TLS_CA_FILE || '',
    certPath: env.OLLAMA_TLS_CERT_FILE || '',
    keyPath: env.OLLAMA_TLS_KEY_FILE || '',
    serverName: env.OLLAMA_TLS_SERVER_NAME || '',
  };
  if (production && (!ollamaTls.caPath || !ollamaTls.certPath ||
      !ollamaTls.keyPath || !ollamaTls.serverName || !/^[a-zA-Z0-9.-]{1,253}$/.test(ollamaTls.serverName))) {
    throw new Error('Production Ollama requires explicit mTLS CA, client certificate, private key and verified server name');
  }
  if (!production && origin.startsWith('https:') &&
      (!ollamaTls.caPath || !ollamaTls.certPath || !ollamaTls.keyPath || !ollamaTls.serverName)) {
    throw new Error('HTTPS Ollama requires a complete mTLS configuration');
  }
  // No direct Google configuration is consulted when Ollama is selected.
  return { ollamaModel, ollamaVisionModel, ollamaBaseUrl, ollamaTls };
}
