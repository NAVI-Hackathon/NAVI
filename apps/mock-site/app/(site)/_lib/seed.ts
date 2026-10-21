/**
 * 模擬官網讀取 data/cardif_seed_data.json（本地檔，不對真實官網發請求）。
 * 外部資料一律先經 zod 驗證；格式不符時 build 直接失敗。
 * 只描述網站頁面用得到的欄位，其餘欄位會被略過。
 */
import { z } from "zod";
import raw from "@/data/cardif_public_data.json";

const StringList = z.array(z.string());

const ServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  url: z.url(),
  channels: StringList,
  requires_login: z.boolean(),
  apply_time: z.string().nullable(),
  effective_time: z.string().nullable(),
  documents: StringList,
  notes: StringList,
  related_forms: StringList,
  keywords: StringList,
  online_available: z.string(),
  precheck_questions: StringList.default([]),
  partner_hospitals: StringList.optional(),
});
export type SeedService = z.infer<typeof ServiceSchema>;

const FormSchema = z.object({
  id: z.string(),
  name: z.string(),
  note: z.string().optional(),
  page: z.url().optional(),
  url: z.url().optional(),
});
export type SeedForm = z.infer<typeof FormSchema>;

const SitemapLinkSchema = z.object({ name: z.string(), url: z.url() });
const SitemapGroupSchema = SitemapLinkSchema.extend({
  children: z.array(SitemapLinkSchema).default([]),
});
export type SitemapGroup = z.infer<typeof SitemapGroupSchema>;

const SeedSchema = z.object({
  meta: z.object({ source: z.url(), crawled: z.iso.date() }),
  sitemap: z.array(SitemapGroupSchema),
  services: z.array(ServiceSchema),
  online_service_features: z.record(z.string(), StringList),
  claim_document_requirements: z.record(z.string(), StringList),
  claim_general_rules: StringList,
  forms: z.array(FormSchema),
  faq: z.array(z.object({ q: z.string(), a: z.string(), source: z.url() })),
  contacts: z.object({
    hotline: z.string(),
    address: z.string(),
    outbound_call_number: z.string(),
  }),
});

export const seed = SeedSchema.parse(raw);

/** 擷取日期，頁面標示資料來源用 */
export const retrievedAt = seed.meta.crawled;

export function getService(id: string): SeedService {
  const service = seed.services.find((s) => s.id === id);
  if (!service) throw new Error(`seed 找不到服務：${id}`);
  return service;
}

export function getForm(id: string): SeedForm {
  const form = seed.forms.find((f) => f.id === id);
  if (!form) throw new Error(`seed 找不到表單：${id}`);
  return form;
}

export function servicesByCategory(category: string): SeedService[] {
  return seed.services.filter((s) => s.category === category);
}
