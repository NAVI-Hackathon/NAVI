import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { isOllamaImage, MAX_IMAGE_BYTES } from '../../../apps/api/src/ai/ollamaImages.js';

const model = z.string().regex(/^[a-z0-9][a-z0-9._-]*:[a-zA-Z0-9._-]+$/).max(100);
const roles = z.enum(['system', 'user', 'assistant', 'tool']);
const imageLimit = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);
const message = z.object({
  role: roles,
  content: z.string().max(24000),
  images: z.array(z.string().max(imageLimit)).max(2).optional(),
  tool_calls: z.array(z.json()).max(8).optional(),
  tool_name: z.string().max(120).optional(),
}).strict();

const settings = z.object({
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().min(0).max(100).optional(),
  seed: z.number().int().optional(),
  num_ctx: z.number().int().min(256).max(8192).optional(),
  num_predict: z.number().int().min(1).max(2048).optional(),
}).strict();
const common = z.object({
  model,
  stream: z.boolean().default(true),
  think: z.boolean().optional(),
  keep_alive: z.union([z.number(), z.string().max(16)]).optional(),
  format: z.union([z.literal('json'), z.record(z.string(), z.json())]).optional(),
  options: settings.optional(),
}).strict();
const chat = common.extend({ messages: z.array(message).min(1).max(32), tools: z.array(z.json()).max(8).optional() });
const generate = common.extend({ prompt: z.string().max(24000).refine(value => value.trim().length > 0), system: z.string().max(24000).optional() });
const client = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  text: z.array(model).min(1).max(8),
  vision: z.array(model).max(8),
  rpm: z.number().int().min(1).max(60),
  pending: z.number().int().min(1).max(4),
}).strict();
export const clientPolicies = z.object({ adrift: client, navi: client }).strict().refine(
  value => value.adrift.token !== value.navi.token && value.adrift.vision.length === 0,
);

export function clientIdentity(header, policies) {
  if (typeof header !== 'string') return null;
  const presented = Buffer.from(header);
  return Object.keys(policies).find(id => {
    const expected = Buffer.from('Bearer ' + policies[id].token);
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  }) ?? null;
}

function validImage(value) {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) return false;
  return ['image/png', 'image/jpeg', 'image/webp'].some(mime => isOllamaImage(bytes, mime));
}

export function validateGeneration(body, policy, isChat) {
  const parsed = (isChat ? chat : generate).safeParse(body);
  if (!parsed.success) return { error: 'invalid_input' };
  const data = parsed.data;
  const images = data.messages?.flatMap(entry => entry.images ?? []) ?? [];
  if ((isChat && !data.messages.some(entry => entry.role === 'user' && entry.content.trim())) || images.length > 2 ||
      data.messages?.some(entry => entry.images?.length && entry.role !== 'user') ||
      images.some(value => !validImage(value))) return { error: 'invalid_input' };
  if (!(images.length ? policy.vision : policy.text).includes(data.model)) return { error: 'model_not_allowed' };
  // Never forward caller-controlled GPU placement or unlimited context/generation.
  return { data: { ...data, keep_alive: 0, options: { num_ctx: 4096, num_predict: 1536, ...data.options } } };
}

export const showRequest = z.object({ model }).strict();
