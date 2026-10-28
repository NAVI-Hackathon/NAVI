import { z } from 'zod';
import { IntentDataSchema, MAX_MESSAGE_LENGTH } from './intelligence.js';
import { ServiceJourneySchema } from './journey.js';

// Additive contracts: old understanding and journey responses remain unchanged.
export const TaskUnderstandingSchema = z.object({
  tasks: z.array(z.object({
    persistedTaskId:z.string().uuid().optional(), id: z.string().regex(/^task-[1-4]$/), input: z.string().min(1).max(MAX_MESSAGE_LENGTH), data: IntentDataSchema,
    outcome: z.enum(['supported', 'preview', 'clarification', 'human_review']),
  }).strict()).min(1).max(4),
  batchId:z.string().uuid().optional(), nextStep: z.literal('confirm_one_task'), provider: z.enum(['live', 'demo']), isMock: z.boolean(),
  disclaimer: z.string(),
}).strict();
export const CorrectJourneyIntentRequestSchema = z.object({ message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) }).strict();
export const CorrectJourneyIntentResponseSchema = z.object({
  journey: ServiceJourneySchema, previousServiceType: IntentDataSchema.shape.serviceType,
  evidenceRetained: z.literal(true), requiresRevalidation: z.literal(true),
}).strict();
