import { z } from 'zod';

export const KnowledgeVersionIdSchema = z.string().regex(/^kb-[a-z0-9-]+$/);
export const canonicalKnowledgeJson = value => JSON.stringify(value, (_key, item) => item && !Array.isArray(item) && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const KnowledgeReleaseSchema = z.object({
  schemaVersion: z.literal(1), knowledgeVersion: KnowledgeVersionIdSchema, releasedAt: z.iso.datetime({ offset: true }),
  approvedChangeIds: z.array(z.string()), previousRelease: KnowledgeVersionIdSchema.nullable(), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceManifest: z.array(z.object({ sourceId: z.string(), sourceUrl: z.url(), retrievedAt: z.iso.date() }).strict()),
  syntheticDemo: z.boolean(), snapshot: z.unknown(),
}).strict();
