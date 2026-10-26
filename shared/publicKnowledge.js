import { z } from 'zod';

// Only these public snapshot fields may cross the build-time browser boundary.
const strings = z.array(z.string());
const url = z.url();
const date = z.iso.date();
const link = z.object({ name: z.string(), url });
const sitemapNode = z.lazy(() => link.extend({ children: z.array(sitemapNode).optional() }));
export const PublicKnowledgeSchema = z.object({
  meta: z.object({ source: url, crawled: date, knowledgeVersion: z.string().regex(/^kb-[a-z0-9-]+$/).optional(), syntheticDemo: z.literal(true).optional() }),
  sitemap: z.array(link.extend({ children: z.array(sitemapNode).default([]) })),
  services: z.array(z.object({
    id: z.string(), name: z.string(), category: z.string(), url,
    channels: strings, requires_login: z.boolean(), apply_time: z.string().nullable(), effective_time: z.string().nullable(),
    documents: strings, notes: strings, related_forms: strings, keywords: strings, online_available: z.string(),
    precheck_questions: strings.default([]), partner_hospitals: strings.optional(),
    online_requirements: strings.optional(), retrievedAt: date.optional(),
  })),
  online_service_features: z.record(z.string(), strings),
  claim_document_requirements: z.record(z.string(), strings), claim_general_rules: strings,
  forms: z.array(z.object({ id: z.string(), name: z.string(), note: z.string().optional(), page: url.optional(), url: url.optional(), retrievedAt: date.optional() })),
  faq: z.array(z.object({ q: z.string(), a: z.string(), source: url, retrievedAt: date.optional() })),
  contacts: z.object({ hotline: z.string(), address: z.string(), outbound_call_number: z.string() }),
  glossary: z.array(z.object({
    id: z.string(), term: z.string(), definition: z.string(), category: z.string(), keywords: strings,
    sourceType: z.literal('public_site_snapshot'), sourceTitle: z.string(), sourceUrl: url, retrievedAt: date,
  })),
});
export const projectPublicKnowledge = value => PublicKnowledgeSchema.parse(value);
