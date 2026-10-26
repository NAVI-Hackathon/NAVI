import { z } from 'zod';
import raw from '../data/cardif_public_data.json' with { type: 'json' };

// Read the team's local public-site snapshot. No runtime requests to insurer websites.
const strings = z.array(z.string());
const officialUrl = z.url().regex(/^https:\/\/life\.cardif\.com\.tw\//);
export const cardif = z.object({
  meta: z.object({ crawled: z.iso.date(), knowledgeVersion: z.string().regex(/^kb-[a-z0-9-]+$/).optional(), syntheticDemo: z.literal(true).optional() }),
  services: z.array(z.object({ id: z.string(), name: z.string(), category: z.string(), url: officialUrl, channels: strings, documents: strings, notes: strings, keywords: strings.optional(), partner_hospitals: strings.optional(), precheck_questions: strings.optional(), requires_login: z.boolean().optional(), related_forms: strings.optional(), apply_time: z.string().nullable().optional(), effective_time: z.string().nullable().optional(), online_available: z.string().nullable().optional(), online_requirements: strings.optional(), retrievedAt: z.iso.date().optional() })),
  forms: z.array(z.object({ id: z.string(), name: z.string(), note: z.string().optional(), page: officialUrl.optional(), url: officialUrl.optional(), retrievedAt: z.iso.date().optional() })),
  faq: z.array(z.object({ q: z.string(), a: z.string(), source: officialUrl, retrievedAt: z.iso.date().optional() })),
  claim_document_requirements: z.record(z.string(), strings), claim_general_rules: strings,
  contacts: z.object({ hotline: z.string() }),
  glossary: z.array(z.object({ id: z.string().regex(/^[a-z]+(?:-[a-z]+)*$/), term: z.string().min(1), definition: z.string().min(1), category: z.string(), keywords: strings, sourceType: z.literal('public_site_snapshot'), sourceTitle: z.string(), sourceUrl: officialUrl, retrievedAt: z.iso.date() }).strict()).default([]),
}).parse(raw);
export const sitePaths = Object.freeze({
  'https://life.cardif.com.tw/zh/a3': '/services',
  'https://life.cardif.com.tw/zh/a311': '/services/forms',
  'https://life.cardif.com.tw/zh/a312': '/services/policy-change',
  'https://life.cardif.com.tw/zh/a313': '/services/policy-loan',
  'https://life.cardif.com.tw/zh/a314': '/services/claims',
  'https://life.cardif.com.tw/zh/f8': '/services/online',
  'https://life.cardif.com.tw/insurancedictionary': '/glossary',
});
const titles = { '/services': '保戶服務', '/services/forms': '常用表單下載', '/services/policy-change': '保單變更', '/services/policy-loan': '保單借款', '/services/claims': '理賠程序介紹', '/services/online': '網路保險服務', '/glossary': '保險名詞' };
export const officialSource = (url, retrievedAt = cardif.meta.crawled) => ({ url, title: titles[sitePaths[url]] ?? '法國巴黎人壽官網', retrievedAt });
export const kebab = id => id.replace(/[_.\s]+/g, '-').toLowerCase();
export function formAnchor(id) {
  const base = id.startsWith('form_') ? kebab(id) : `form-${kebab(id)}`;
  return ['form_contract_change', 'form_policyholder_change'].includes(id) ? `${base}-investment` : base;
}
export const cardifService = id => {
  const service = cardif.services.find(item => item.id === id);
  if (!service) throw new Error(`Missing local Cardif service: ${id}`);
  return service;
};
export const claimsUrl = cardifService('claim_by_mail').url;
export const formsUrl = 'https://life.cardif.com.tw/zh/a311';
export const destination = (kind, path, anchor, label, url) => ({ kind, path, anchor, label: label.slice(0, 40), source: officialSource(url) });

// Destinations are source/row pairs, not merely strings that look like local URLs.
const targets = [
  ...cardif.glossary.map(term => ({ path: '/glossary', anchor: `glossary-term-${term.id}`, url: term.sourceUrl })),
  ...Object.entries(sitePaths).map(([url, path]) => ({ path, anchor: null, url })),
  { path: '/', anchor: null, url: 'https://life.cardif.com.tw/zh/a3' },
  ...cardif.services.map(s => ({ path: sitePaths[s.url], anchor: `service-${kebab(s.id)}`, url: s.url })),
  ...cardif.forms.map(f => ({ path: '/services/forms', anchor: formAnchor(f.id), url: formsUrl })),
  // PR #2's claim journey cites the claims page for its application-form link.
  { path: '/services/forms', anchor: formAnchor('claim_1.1.1'), url: claimsUrl },
  ...['form_contract_change', 'form_policyholder_change'].flatMap(id => ['investment', 'protection', 'participating'].map(type => ({ path: '/services/forms', anchor: `${kebab(id)}-${type}`, url: formsUrl }))),
  ...cardif.faq.map((f, i) => ({ path: '/faq', anchor: `faq-${i + 1}`, url: f.source })),
  ...Object.keys(cardif.claim_document_requirements).map((_, i) => ({ path: '/services/claims', anchor: `claim-doc-${i + 1}`, url: claimsUrl })),
  ...cardif.claim_general_rules.map((_, i) => ({ path: '/services/claims', anchor: `claim-rule-${i + 1}`, url: claimsUrl })),
];
export const isTrustedDestination = target => targets.some(item => item.path === target.path && item.anchor === target.anchor && item.url === target.source.url);
