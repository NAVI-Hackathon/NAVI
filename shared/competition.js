import { z } from 'zod';
import { JOURNEY_STATES, KnowledgeSourceSchema, NextActionSchema, NavigationTargetSchema, RequirementSchema, ConsistencyIssueSchema } from './journey.js';

// Additive contracts: existing Journey, navigation messages and endpoints are unchanged.
export const NavigationPlanRequestSchema = z.union([
  z.object({ query: z.string().trim().min(1).max(500) }).strict(),
  z.object({ sourceId: z.string().min(1).max(100) }).strict(),
]);
export const NavigationStepSchema = z.object({
  id: z.string(), order: z.number().int().positive(), sourceId: z.string(),
  action: z.enum(['VIEW_INFORMATION', 'VIEW_FORM', 'OPEN_SERVICE']),
  instruction: z.string(), source: KnowledgeSourceSchema, destination: NavigationTargetSchema,
  evidence: z.array(z.string().min(1)).min(1),
}).strict();
export const NavigationPlanSchema = z.object({
  version: z.literal(1), rootSourceId: z.string(), steps: z.array(NavigationStepSchema).min(1).max(4),
  execution: z.literal('user_guided'), disclaimer: z.string(),
}).strict();
export const NavigationPlanResponseSchema = z.object({
  status: z.enum(['answered', 'not_found', 'out_of_scope']), plan: NavigationPlanSchema.nullable(), hotline: z.string(),
}).strict().refine(value => (value.status === 'answered') === (value.plan !== null));
export const KnowledgeEvidenceSchema = z.object({
  source: KnowledgeSourceSchema.refine(source => source.type === 'public_site_snapshot'),
  excerpts: z.array(z.string().min(1)).min(1).max(3),
  snapshot: z.object({ status: z.enum(['snapshot_available', 'review_recommended']), ageDays: z.number().int().nonnegative() }).strict(),
  verificationScope: z.literal('local_snapshot'), liveWebsiteChecked: z.literal(false),
}).strict();
export const KnowledgeEvidenceResponseSchema = z.object({
  status: z.enum(['answered', 'not_found', 'out_of_scope']), results: z.array(KnowledgeEvidenceSchema).max(3),
  hotline: z.string(), disclaimer: z.string(),
}).strict().refine(value => (value.status === 'answered') === (value.results.length > 0));
export const JourneyExplanationSchema = z.object({
  journeyId: z.uuid(), journeyUpdatedAt: z.iso.datetime(), readiness: z.number().int().min(0).max(100),
  currentStage: z.enum(Object.values(JOURNEY_STATES)), supported: z.boolean(),
  criteria: z.array(RequirementSchema.extend({
    earned: z.number().int().min(0).max(100),
    reasonCode: z.enum(['VERIFIED', 'OPTIONAL', 'MANUAL_UNVERIFIED', 'DOCUMENT_NEEDS_REVIEW', 'DOCUMENT_MISSING', 'INFORMATION_MISSING', 'CONFIRMATION_REQUIRED']),
    reason: z.string(),
  }).strict()),
  missingRequirementIds: z.array(z.string()), consistencyIssues: z.array(ConsistencyIssueSchema),
  nextAction: NextActionSchema, sources: z.array(KnowledgeSourceSchema), disclaimer: z.string(),
}).strict();
export const HandoffSummarySchema = z.object({
  issue: z.string(), collected: z.array(z.string()), missing: z.array(z.string()),
  concerns: z.array(z.string()), reason: z.string(), provider: z.enum(['demo', 'live', 'provided']),
  sources: z.array(KnowledgeSourceSchema), redacted: z.literal(true), disclaimer: z.string(),
}).strict();
export const HandoffPreviewSchema = z.object({
  previewId: z.uuid(), journeyId: z.uuid(), expiresAt: z.iso.datetime(),
  status: z.literal('awaiting_confirmation'), summary: HandoffSummarySchema,
}).strict();
export const HandoffConfirmRequestSchema = z.object({ previewId: z.uuid(), confirmed: z.literal(true) }).strict();
export const HandoffConfirmationSchema = z.object({
  previewId: z.uuid(), journeyId: z.uuid(), confirmedAt: z.iso.datetime(),
  status: z.literal('confirmed'), delivery: z.literal('not_sent'), summary: HandoffSummarySchema,
}).strict();
