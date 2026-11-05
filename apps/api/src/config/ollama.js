import { ollamaOrigin } from '../ai/ollamaTransport.js';

export const OLLAMA_TEXT_MODEL = 'qwen3:4b-instruct-2507-q4_K_M';
export const OLLAMA_VISION_MODELS = Object.freeze(['qwen3.5:4b', 'qwen3-vl:4b-instruct']);

export function ollamaConfig(env) {
  if (env.NODE_ENV === 'production' || env.NAVI_PRODUCT_MODE === 'true' || env.AI_PUBLIC_SYNTHETIC === 'true' ||
      env.TRUST_PROXY_LOOPBACK === 'true' || (env.HOST && env.HOST !== '127.0.0.1') ||
      (env.NAVI_TEST_SESSION_TOKEN?.trim().length ?? 0) < 32 || (env.AI_MAX_CONCURRENT && Number(env.AI_MAX_CONCURRENT) !== 1)) {
    throw new Error('Ollama requires a private loopback sandbox, an operator token and a single generation slot');
  }
  const ollamaModel = env.OLLAMA_TEXT_MODEL || OLLAMA_TEXT_MODEL;
  const ollamaVisionModel = env.OLLAMA_VISION_MODEL || '';
  if (ollamaModel !== OLLAMA_TEXT_MODEL || (ollamaVisionModel && !OLLAMA_VISION_MODELS.includes(ollamaVisionModel))) throw new Error('Invalid Ollama sandbox model');
  return { ollamaModel, ollamaVisionModel, ollamaBaseUrl: ollamaOrigin(env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434') };
}
