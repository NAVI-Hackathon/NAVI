import { cardif, cardifService, claimsUrl, formsUrl, destination, formAnchor } from './cardif.js';
import { z } from 'zod';
const date = z.iso.date();

export const HOSPITAL_WEIGHTS = Object.freeze({ incident: 20, service: 15, diagnosis_certificate: 20, inpatient_info: 15, bank_passbook: 20, confirmation: 10 });
export const HOSPITAL_DISCLAIMER = '準備完成度只代表原型定義的資料準備完成，不代表保障適用、理賠核准、已送件或已核付；仍須依保單條款與保險公司審核。';
export const hasNegatedHospitalization = text => /(?:沒有住院|沒住院|未住院|不用住院|未曾住院|不曾住院|不是住院|非住院|沒有入院|未入院|沒有住過院|未住過院)(?!證明|證|文件|資料)|(?:not |never (?:been )?|wasn['’]t |weren['’]t |haven['’]t been |hadn['’]t been )(?:been )?hospitali[sz]ed|outpatient(?: treatment)? only/i.test(text);
const upload = cardifService('claim_hospital_upload');
const chain = cardifService('claim_union_chain');
const mail = cardifService('claim_by_mail');
export const partnerHospitals = upload.partner_hospitals;
const pick = (list, keyword) => {
  const item = list.find(text => text.includes(keyword));
  if (!item) throw new Error(`Missing local Cardif rule: ${keyword}`);
  return item;
};
export const hospitalRules = Object.freeze({
  diagnosis: pick(cardif.claim_general_rules, '診斷證明書'),
  passbook: pick(cardif.claim_general_rules, '存摺影本'),
  hospitalCertificate: pick(upload.notes, '診斷書'),
  hospitalPartners: pick(upload.notes, '合作醫療院所'),
  chainOriginals: pick(chain.notes, '10日內'),
  chainAmount: pick(chain.notes, '30萬'),
});
export const hospitalDestinations = Object.freeze({
  documents: destination('page', '/services/claims', `claim-doc-${Object.keys(cardif.claim_document_requirements).indexOf('住院醫療') + 1}`, '查看住院醫療應備文件', claimsUrl),
  rules: destination('page', '/services/claims', `claim-rule-${cardif.claim_general_rules.indexOf(hospitalRules.passbook) + 1}`, '查看匯款給付規定', claimsUrl),
  form: destination('form', '/services/forms', formAnchor('claim_1.1.1'), '下載保險金申請書', formsUrl),
  hospitalUpload: destination('entry_point', '/services/claims', 'service-claim-hospital-upload', '查看保險理賠醫起通', claimsUrl),
  unionChain: destination('entry_point', '/services/claims', 'service-claim-union-chain', '查看理賠聯盟鏈', claimsUrl),
  mail: destination('page', '/services/claims', 'service-claim-by-mail', '查看郵寄申請方式', claimsUrl),
});
const aliases = [[/^北榮/, '臺北榮民總醫院'], [/^中榮/, '臺中榮民總醫院'], [/^高榮/, '高雄榮民總醫院'], [/^(臺北|臺中|高雄)榮總/, '$1榮民總醫院'], [/^三總/, '三軍總醫院'], [/^臺大(?!醫院)/, '臺大醫院']];
export function normalizeHospitalName(name) {
  let value = String(name ?? '').normalize('NFKC').replace(/台/g, '臺').replace(/\s+/g, '');
  for (const [pattern, replacement] of aliases) value = value.replace(pattern, replacement);
  return value;
}
export function matchPartnerHospital(name) {
  const key = normalizeHospitalName(name);
  if (!key) return null;
  const exact = partnerHospitals.find(official => normalizeHospitalName(official) === key);
  if (exact) return exact;
  // Only named, unambiguous aliases. Never turn an unlisted branch into a partner.
  const alias = { 三軍總醫院: '三軍總醫院附設民眾診療服務處', 新光醫院: '新光吳火獅紀念醫院', 國泰醫院: '國泰綜合醫院', 雙和醫院: '衛生福利部雙和醫院' }[key];
  return alias && partnerHospitals.includes(alias) ? alias : null;
}
export function findHospitalMention(story) {
  const text = String(story ?? '');
  const candidates = [...partnerHospitals, '台中榮總', '臺中榮總', '台北榮總', '臺北榮總', '高雄榮總', '台大醫院', '台大', '臺大', '北榮', '中榮', '高榮', '三總'];
  // Match a whole branch phrase first; an unmatched branch must not fall back to the main campus.
  const mention = text.match(/(?:[\u4e00-\u9fff]{1,16}?(?:榮總|醫院|醫學中心)(?:[\u4e00-\u9fff]{1,5}分院)?)/)?.[0];
  // Strip narrative prefixes only before the hospital, never the 在 inside 不存在分院.
  if (mention) return mention.replace(/^.*?(?:在|到|去|於)(?=.*(?:榮總|醫院|醫學中心))/, '').replace(/^(?:我|上週|昨天|前天|今天|之前)+/, '');
  return candidates.filter(name => text.includes(name)).sort((a, b) => b.length - a.length)[0] ?? null;
}
export function reportedStayDays(story) {
  const value = (story.match(/(?:住院|住了|住)(?:約|大約|了)?\s*(\d+|[一二兩三四五六七八九十]+|five|seven)\s*(?:天|days?)/i)?.[1] ?? story.match(/(?:hospitali[sz]ed|inpatient|stayed).{0,35}?(\d+|five|seven)\s*days?/i)?.[1])?.toLowerCase();
  const numbers = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, five: 5, seven: 7 };
  const days = value ? numbers[value] ?? Number(value) : null;
  return Number.isInteger(days) && days > 0 && days <= 3660 ? days : null;
}
export function calculateStay(fields) {
  const { admissionDate, dischargeDate, reportedInpatientDays } = fields;
  if (admissionDate && dischargeDate) {
    if (!date.safeParse(admissionDate).success || !date.safeParse(dischargeDate).success) return { days: null, source: null };
    const days = (Date.parse(dischargeDate) - Date.parse(admissionDate)) / 86400000 + 1;
    return Number.isInteger(days) && days > 0 && days <= 3660 ? { days, source: 'dates' } : { days: null, source: null };
  }
  return Number.isInteger(reportedInpatientDays) && reportedInpatientDays > 0 && reportedInpatientDays <= 3660 ? { days: reportedInpatientDays, source: 'printed_days' } : { days: null, source: null };
}
export function hospitalClaimContext(extractedData, documents = []) {
  const certificate = documents.find(doc => doc.documentType === 'diagnosis_certificate' && doc.status === 'verified');
  const mentioned = certificate?.fields.hospitalName ?? extractedData.hospitalName ?? null;
  const matchedName = matchPartnerHospital(mentioned);
  const hospital = mentioned ? { mentioned, matchedName, partner: Boolean(matchedName) } : null;
  const stay = certificate ? calculateStay(certificate.fields) : { days: extractedData.reportedInpatientDays ?? null, source: extractedData.reportedInpatientDays ? 'user_reported' : null };
  return {
    hospital,
    inpatient: { admissionDate: certificate?.fields.admissionDate ?? extractedData.admissionDate ?? null, dischargeDate: certificate?.fields.dischargeDate ?? extractedData.dischargeDate ?? null, days: stay.days, source: stay.source },
    channels: [
      { id: 'hospital_upload', name: upload.name, available: Boolean(matchedName), notes: upload.notes, destination: hospitalDestinations.hospitalUpload },
      { id: 'union_chain', name: chain.name, available: true, notes: chain.notes, destination: hospitalDestinations.unionChain },
      { id: 'mail', name: mail.name, available: true, notes: mail.notes, destination: hospitalDestinations.mail },
    ],
    reminders: [hospitalRules.hospitalCertificate, hospitalRules.hospitalPartners, hospitalRules.chainOriginals, hospitalRules.chainAmount],
  };
}
export const hospitalJourneyDefinition = {
  title: '住院醫療理賠', documentTypes: ['diagnosis_certificate', 'bank_passbook'], disclaimer: HOSPITAL_DISCLAIMER,
  sourceIds: [hospitalDestinations.documents.anchor.replace('claim-doc-', 'claim-doc:'), hospitalDestinations.rules.anchor.replace('claim-rule-', 'claim-rule:'), 'service:claim_hospital_upload', 'service:claim_union_chain'],
  requirements: [
    { id: 'incident', name: '事件資訊', description: '已整理住院情況。', required: true },
    { id: 'service', name: '服務辨識', description: '已辨識住院需求，不代表理賠資格。', required: true },
    { id: 'diagnosis_certificate', name: '診斷書或住院證明', description: hospitalRules.diagnosis, required: true },
    { id: 'inpatient_info', name: '住院資訊', description: '醫院、病患與有效住院期間，或文件明載住院天數。天數僅為原型資料整理，不是給付日數。', required: true },
    { id: 'bank_passbook', name: '存摺影本', description: `${hospitalRules.passbook}；本原型示範匯款給付。`, required: true },
    { id: 'confirmation', name: '資料確認', description: '確認已整理資料並填妥保險金申請書；本原型不驗證簽名或送件。', required: true },
    ...cardif.claim_document_requirements['住院醫療'].filter(name => name.includes('依病況')).map((name, i) => ({ id: `optional_${i + 1}`, name, description: '依病況需要時提供，由保險公司確認。', required: false })),
  ].map(r => ({ ...r, weight: HOSPITAL_WEIGHTS[r.id] ?? 0 })),
};
