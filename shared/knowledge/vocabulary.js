// Query-only aliases change retrieval terms, never the quoted snapshot facts.
export const SYNONYMS = [
  [/理賠表單|claim form/gi, '保險金申請書'],
  [/^(?:需要)?(?:哪些)?文件[？?]?\s*$|^what (?:insurance claim )?documents are required[?]?\s*$/gi, '理賠申請文件'],
  [/outpatient(?: surgery| treatment)?|門診(?:小)?(?:手術|開刀)/gi, '門診 手術'],
  [/hospitali[sz]ation|inpatient|hospitali[sz]ed/gi, '住院醫療'],
  [/premium payment|payment method|保費付款|保費繳納|扣繳方式|扣款方式|缴费方式/gi, '繳費方式'],
  [/dividend payment|dividend option|紅利領取/gi, '紅利給付'],
  [/policy loan|borrow money|保單借貸/gi, '保單借款'],
  [/beneficiary(?: change)? form/gi, '受益人變更 表單'], [/beneficiary(?: change)?/gi, '受益人變更'],
  [/change (?:my )?address|address change|moving house/gi, '變更通訊地址'],
  [/password(?: is)? (?:locked|lock)|locked password/gi, '密碼鎖住'],
  [/password/gi, '密碼'], [/customer (?:service|support)|hotline/gi, '客服專線'],
  [/online service|website service|官網服務入口/gi, '網路保險服務'],
  [/insurance claim/gi, '理賠'], [/documents?|requirements?/gi, '文件'], [/claim/gi, '理賠'],
  [/form|download/gi, '表單 下載'],
  [/癌症/g, '防癌'], [/過世|死亡|往生/g, '身故'], [/殘廢/g, '失能'],
  [/锁/g, '鎖'], [/看診|看醫生/g, '門診'], [/電話/g, '專線'], [/通訊地阯|通訊地止|住址/g, '通訊地址'],
];
const FILLER = /請問|我想要|我想|想要|我要|我的|要怎麼|怎麼|如何|可以|需要|什麼|哪裡|在哪|一下|有沒有|是不是|應該|哪些|幫我|告訴我|幾號|做了|我只有|只有|上週|最近|[嗎呢吧啊了的]|\b(?:how|do|i|my|what|are|is|for|a|the|to|need|please|can|have|had|was|not|never|only)\b/g;
export const normalizeQuery = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/臺/g, '台').replace(/没有/g, '沒有').replace(/[\s\p{P}\p{S}]+/gu, ' ');
const NEGATED = /(?:沒有|沒|未曾|未|不曾|不用|不是|非)(?:住院|住過院|入院)(?!證明|證|文件|資料)|(?:not|never)(?: been)? hospitali[sz]ed|no hospitali[sz]ation/gi;
export const rewrite = text => SYNONYMS.reduce((out, [pattern, word]) => out.replace(pattern, word), normalizeQuery(text).replace(NEGATED, ' '));
export function tokens(text) {
  const out = new Set();
  for (const segment of rewrite(text).replace(FILLER, ' ').split(' ')) {
    for (const word of segment.match(/[a-z0-9]{2,}/g) ?? []) out.add(word);
    const han = segment.replace(/[a-z0-9]/g, '');
    for (let i = 0; i + 1 < han.length; i++) out.add(han.slice(i, i + 2));
  }
  return out;
}
export const TYPE_CUES = [
  { pattern: /表單|申請書|授權書|下載|填寫|form|download/i, type: 'form', boost: 1.4 },
  { pattern: /多久|幾天|幾次|收不到|鎖住|密碼|條件|password/i, type: 'faq', boost: 1.3 },
  { pattern: /文件|準備|證明|資料|documents?|requirements?/i, type: 'claim_documents', boost: 1.2 },
];
export const SERVICE_CUES = [{ pattern: /變更.*受益人|受益人.*變更|change.*beneficiary|beneficiary.*change/i, exclude: /表單|申請書|下載|form|download/i, id: 'service:change_beneficiary' }, { pattern: /官網.*(?:入口|服務)|網路保險服務|online service|website service/i, id: 'service:online_service_membership' }, { pattern: /^(?:保險理賠|保險)?醫起通(?:是什麼)?[？?]?$/, id: 'service:claim_hospital_upload' }];
export const RANKING = Object.freeze({ title: 3, keyword: 2.5, body: 1, exactTitle: 8, partialTitle: 3, phrase: 6, phraseCoverage: .8, minCoverage: .45, minScore: 2.5, minDistinctive: 2.2, resultRatio: .6, contextPhrase: 24, outpatientBoost: 1.8, inpatientBoost: 1.4 });
export const isDecisionQuestion = query => /(?:保證|肯定|百分之百|100[%％])(?:一定)?(?:可以|能|會)?(?:理賠|核賠|給付|獲賠)|一定(?:可以|能|會|獲得)?(?:理賠|核賠|給付|獲賠|賠)|(?:理賠|核賠|給付).{0,4}(?:保證|一定通過|一定核准|肯定)|買.{0,6}(險|保單)|推薦|划算|該買|買哪|要不要買|適合.*(保單|保險)|(?:能|可|會)不(?:能|可|會)?(?:以)?(?:理)?賠|能否.*(?:理賠|獲賠)|可否.*理賠|(?:能|可以|會|是否).{0,8}(?:理賠|獲賠|給付|賠)(?!表單|申請書|文件|流程|服務|方式|入口).{0,3}[嗎?？]|賠不賠|賠多少|(?:領|賠).{0,5}多少|保險金額|給付日數|給付金額|理賠金額|核准|拒賠|保障適用|符合理賠|是否.*保障|am i covered|eligible|compensation amount|will.*pay|can (?:i|we) (?:claim|get compensation|receive compensation)(?! forms?| documents?)|recommend.*insurance|(?:which|what) insurance.*(?:buy|best|choose)|should.*buy.*insurance|best.*insurance|insurance.*recommendation/i.test(String(query ?? '').normalize('NFKC').replace(/(?:不需要|不用|不必|不要求|無法|不能|不會|不)保證/g, ' ').replace(/\s+/g, ' '));
export function queryProfile(text) {
  return {
    outpatient: /門診|看診|看醫生|outpatient/i.test(text),
    inpatient: /住院|inpatient|hospitali[sz]/i.test(text),
    unsupported: /班機|航班|登機證|延誤|車禍|flight|boarding|accident|credit card annual fee|信用卡年費|火星|invented|不存在.*(?:方案|保單)|^帳戶服務[？?]?$/i.test(text),
  };
}
