import { cardif, sitePaths, claimsUrl, formsUrl, destination, formAnchor, kebab } from '../shared/cardif.js';

const record = (id, title, content, navigationDestination, keywords = []) => ({ id, title, content, navigationDestination, keywords });
export const cardifRecords = [
  ...cardif.services.map(s => record(`service:${s.id}`, s.name, [s.name, ...s.channels.filter(line => !/^https?:/.test(line)), ...s.documents, ...s.notes, ...(s.precheck_questions ?? [])].join('\n'), destination('page', sitePaths[s.url], `service-${kebab(s.id)}`, `查看${s.name}`, s.url), s.keywords ?? [])),
  ...cardif.forms.map(f => record(`form:${f.id}`, f.name, [f.name, ...(f.note ? [f.note] : [])].join('\n'), destination('form', '/services/forms', formAnchor(f.id), `下載${f.name}`, formsUrl))),
  ...cardif.faq.map((f, i) => record(`faq:${i + 1}`, f.q, f.a, destination('faq', '/faq', `faq-${i + 1}`, '查看常見問題', f.source))),
  ...Object.entries(cardif.claim_document_requirements).map(([type, documents], i) => record(`claim-doc:${i + 1}`, `${type}理賠應備文件`, documents.join('\n'), destination('page', '/services/claims', `claim-doc-${i + 1}`, `查看${type}應備文件`, claimsUrl), [type])),
  ...cardif.claim_general_rules.map((rule, i) => record(`claim-rule:${i + 1}`, rule.slice(0, 70), rule, destination('page', '/services/claims', `claim-rule-${i + 1}`, '查看理賠申請規定', claimsUrl))),
];
export const getCardifRecord = id => cardifRecords.find(item => item.id === id) ?? null;
export const cardifSource = item => ({
  id: item.id, sourceId: item.id, title: item.title, section: item.id, type: 'public_site_snapshot', isMock: false,
  url: item.navigationDestination.source.url, sourceUrl: item.navigationDestination.source.url,
  retrievedAt: cardif.meta.crawled, navigationDestination: item.navigationDestination,
});
const normalize = text => text.normalize('NFKC').toLowerCase().replace(/臺/g, '台').replace(/請問|我想|我要|我的|要怎麼|怎麼|如何|可以|需要|什麼|哪些|在哪|哪裡|幫我|[嗎呢了的]/g, '').replace(/[\s\p{P}\p{S}]+/gu, '');
const tokens = text => {
  const value = normalize(text);
  return new Set([...value].slice(0, -1).map((_, i) => value.slice(i, i + 2)));
};
export const isDecisionQuestion = query => /推薦.*(保單|保險)|該買|買哪|適合.*(保單|保險)|能不能賠|會不會賠|能否理賠|可以賠嗎|會賠嗎|賠不賠|賠多少|理賠金額|核准|拒賠|保障適用|符合理賠|是否.*保障|am i covered|eligible|compensation amount|will.*pay|recommend.*insurance/i.test(query);
export function retrieveCardifContext(query) {
  if (isDecisionQuestion(query) || /班機|航班|登機證|延誤|車禍|flight|boarding|accident|credit card annual fee|信用卡年費/i.test(query)) return null;
  const exact = getCardifRecord(query);
  let selected;
  if (exact) selected = [exact];
  else if (/住院|inpatient|hospitalization/i.test(query) && /文件|準備|document|requirement/i.test(query)) selected = cardifRecords.filter(r => r.id.startsWith('claim-doc:') && r.keywords.includes('住院醫療'));
  else if (/受益人|beneficiary/i.test(query) && /表單|申請書|下載|form/i.test(query)) selected = [getCardifRecord('form:form_beneficiary_change'), getCardifRecord('service:change_beneficiary')];
  else if (/地址|搬家|address/i.test(query)) selected = [getCardifRecord('service:change_address')];
  else if (/保單.*(?:借|貸)|policy loan/i.test(query)) selected = [getCardifRecord('service:policy_loan')];
  else if (/密碼|password/i.test(query) && /鎖|lock|輸錯/i.test(query)) selected = cardifRecords.filter(r => r.id.startsWith('faq:') && /鎖/.test(r.title + r.content)).slice(0, 1);
  else if (/官網.*(?:入口|服務)|網路.*服務|註冊|online service|website service/i.test(query)) selected = [getCardifRecord('service:online_service_membership')];
  else if (/^(?:需要)?(?:哪些)?文件[？?]?$|^what documents are required[?]?$/i.test(query)) selected = cardifRecords.filter(r => r.id.startsWith('claim-doc:') && r.keywords.includes('住院醫療'));
  else {
    const wanted = tokens(query);
    if (!wanted.size) return null;
    // shortcut: local bigram matching only; evaluate broader questions before replacing retrieval.
    selected = cardifRecords.map(item => {
      const title = tokens(item.title); const body = tokens(item.content); const keywords = tokens(item.keywords.join(' '));
      let hits = 0; let score = 0;
      for (const token of wanted) {
        const weight = title.has(token) ? 3 : keywords.has(token) ? 2 : body.has(token) ? 1 : 0;
        if (weight) hits++; score += weight;
      }
      return { item, score, coverage: hits / wanted.size };
    }).filter(r => r.coverage >= 0.6 && r.score >= 3).sort((a, b) => b.score - a.score).slice(0, 3).map(r => r.item);
  }
  selected = (selected ?? []).filter(Boolean);
  if (!selected.length) return null;
  // Include whole source lines, bounded to the answer contract; never truncate a factual quote.
  const sources = []; const lines = []; let length = 0;
  for (const item of selected) {
    const included = item.content.split('\n').filter(line => line && length + line.length + 1 <= 1800 && (length += line.length + 1));
    if (included.length) { lines.push(...included); sources.push({ ...cardifSource(item), content: item.content }); }
  }
  return { answer: lines.join('\n'), sources, sourceIds: sources.map(s => s.id), isMock: false };
}
