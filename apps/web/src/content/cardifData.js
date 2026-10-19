import { z } from 'zod';
import raw from '../../../../data/cardif_seed_data.json' with { type: 'json' };

// Insurer facts used by NAVI come only from data/cardif_seed_data.json (the team's
// curated copy of the public BNP Paribas Cardif Life site). Validated once at load.

const StringList = z.array(z.string());
const Service = z.object({
  id: z.string(), name: z.string(), category: z.string(), url: z.url(), channels: StringList, documents: StringList, notes: StringList,
  apply_time: z.string().nullable().optional(), effective_time: z.string().nullable().optional(), requires_login: z.boolean().optional(),
  online_available: z.string().nullable().optional(), related_forms: StringList.optional(), keywords: StringList.optional(), partner_hospitals: StringList.optional(),
});
const Seed = z.object({
  meta: z.object({ crawled: z.iso.date() }),
  services: z.array(Service),
  claim_document_requirements: z.record(z.string(), StringList),
  claim_general_rules: StringList,
  forms: z.array(z.object({ id: z.string(), name: z.string(), note: z.string().optional() })),
  faq: z.array(z.object({ q: z.string(), a: z.string(), source: z.url() })),
  contacts: z.object({ hotline: z.string() }),
});

const seed = Seed.parse(raw);
const service = id => {
  const found = seed.services.find(s => s.id === id);
  if (!found) throw new Error(`cardif_seed_data.json is missing service ${id}`);
  return found;
};
const pick = (list, text) => {
  const found = list.find(item => item.includes(text));
  if (!found) throw new Error(`cardif_seed_data.json is missing "${text}"`);
  return found;
};

export const retrievedAt = seed.meta.crawled;
/** Read-only views of the validated data file, for the deprecated domain/knowledge.js (kept for B's migration check). */
export const seedServices = seed.services;
export const seedForms = seed.forms;
export const seedFaq = seed.faq;
export const seedClaimDocuments = seed.claim_document_requirements;
export const seedClaimRules = seed.claim_general_rules;
export const hotline = seed.contacts.hotline;
export const claimByMail = service('claim_by_mail');
export const hospitalUpload = service('claim_hospital_upload');
export const unionChain = service('claim_union_chain');
export const paymentChange = service('change_payment_method');

/** 住院醫療應備文件, e.g. 保險金申請書、診斷書或住院證明、病理組織檢查報告（依病況）… */
export const inpatientDocuments = seed.claim_document_requirements['住院醫療'];
export const passbookRule = pick(seed.claim_general_rules, '存摺影本');
// Row anchors on the mock site's claims page: 1-based position in the data file (both apps share it).
export const inpatientDocumentsAnchor = `claim-doc-${Object.keys(seed.claim_document_requirements).indexOf('住院醫療') + 1}`;
export const passbookRuleAnchor = `claim-rule-${seed.claim_general_rules.indexOf(passbookRule) + 1}`;
export const diagnosisRule = pick(seed.claim_general_rules, '診斷證明書');

/** Reminders users tend to miss, quoted from the service notes. */
export const reminders = {
  hospitalStillNeedsCertificate: pick(hospitalUpload.notes, '診斷書'),
  hospitalPartnersOnly: pick(hospitalUpload.notes, '合作醫療院所'),
  unionReturnOriginals: pick(unionChain.notes, '10日內'),
  unionLargeAmount: pick(unionChain.notes, '30萬'),
  unionLoginRequired: pick(unionChain.notes, '註冊巴黎線上會員'),
};

export const claimApplicationForm = seed.forms.find(f => f.id === 'claim_1.1.1');
export const claimFaq = seed.faq.filter(f => f.source === claimByMail.url);

export const FORMS_PAGE_URL = 'https://life.cardif.com.tw/zh/a311';

export const pageTitles = {
  [claimByMail.url]: '理賠程序介紹',
  [FORMS_PAGE_URL]: '常用表單下載',
  [paymentChange.url]: '保單變更',
  'https://life.cardif.com.tw/zh/a313': '保單借款',
  'https://life.cardif.com.tw/zh/f8': '網路保險服務',
};

// Official page → mock-site page (same mapping as apps/mock-site/components/site/routes.ts).
const SITE_PATHS = {
  'https://life.cardif.com.tw/zh/a311': '/services/forms',
  'https://life.cardif.com.tw/zh/a312': '/services/policy-change',
  'https://life.cardif.com.tw/zh/a313': '/services/policy-loan',
  'https://life.cardif.com.tw/zh/a314': '/services/claims',
  'https://life.cardif.com.tw/zh/f8': '/services/online',
};
export const sitePathFor = officialUrl => SITE_PATHS[officialUrl] ?? null;

export function officialSource(url) {
  return { url, title: pageTitles[url] ?? '法國巴黎人壽官網', retrievedAt };
}

/** FAQ entries are anchored by their 1-based position in the data file (same rule as the mock site). */
export function faqDestination(faq) {
  return { kind: 'faq', path: '/faq', anchor: `faq-${seed.faq.indexOf(faq) + 1}`, label: '查看常見問題', source: officialSource(faq.source) };
}
