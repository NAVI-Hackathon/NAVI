import { z } from 'zod';
import { normalizeQuery, isDecisionQuestion } from './vocabulary.js';

// Clarifications select a service or missing context; they never establish eligibility.
export const ClarificationSchema = z.object({
  reason: z.enum(['service_unspecified', 'claim_type_missing', 'date_context_missing', 'payment_or_dividend', 'address_type_missing', 'beneficiary_type_missing', 'payment_details_missing', 'insurance_decision']),
  blocking: z.boolean(), question: z.string().min(1).max(500), options: z.array(z.string().min(1).max(100)).max(4),
}).strict();
const clarification = (reason, question, options, blocking = true) => ClarificationSchema.parse({ reason, question, options, blocking });
export function paymentTopics(query) {
  const text = normalizeQuery(query).trim().replace(/(?:不想|不要|不用|不需要|不是要)(?:變更|更改|修改|改|換)?(?:保費|繳費|付款|紅利|分紅)(?:給付方式|繳費方式|方式)?/g, ' ');
  const dividend = /紅利|分紅|dividend/i.test(text);
  const payment = text.replace(/抵繳保費|dividend payment/gi, '');
  return {
    premium: /保費|繳費|缴费|付款|premium|payment/i.test(payment) || !dividend && /扣款|扣繳|信用卡|換卡|轉帳|direct debit/i.test(payment),
    dividend,
  };
}
export function queryClarification(query) {
  const text = normalizeQuery(query).trim();
  if (isDecisionQuestion(text)) return clarification('insurance_decision', 'NAVI 無法保證一定核賠，也不判斷保障適用或給付金額。可以協助查詢申請流程與資料準備；資格與條款請由保險公司專員確認。', ['查詢申請流程', '查詢應備文件', '聯絡客服']);
  const topics = paymentTopics(text);
  if (!topics.premium && !topics.dividend && /(?:變更|更改|修改|改).{0,4}給付方式/.test(text)) return clarification('payment_or_dividend', '你指的是保費繳費方式、紅利給付方式，還是其他服務？請先確認，避免帶到錯誤入口。', ['保費繳費方式', '紅利給付方式', '其他服務']);
  if (topics.premium && topics.dividend) return clarification('payment_or_dividend', '你想處理的是保費繳費方式、紅利給付方式，還是分開處理兩項需求？', ['保費繳費方式', '紅利給付方式', '分開處理兩項需求']);
  const claim = /理賠|申請保險金|insurance claim/i.test(text);
  const unclearDate = /(?:忘記|忘了|想不起|不記得|不確定|不知道|記不清).{0,8}(?:日期|哪一天|哪天)|(?:日期|哪一天|哪天).{0,8}(?:忘記|忘了|想不起|不記得|不確定|不知道|記不清)/.test(text);
  if (claim && unclearDate) return clarification('date_context_missing', '你想申請哪一類理賠？不確定的是事故、住院／出院，還是文件上的日期？請先說明，不需要猜填日期。', ['住院醫療理賠', '門診醫療理賠', '其他理賠', '不確定日期類型']);
  if (claim && /^(?:我)?(?:想要|想|要)?(?:辦理|申請)(?:保險)?理賠[ 可是但]*(?:不知(?:道)?(?:如何|怎麼)辦)?$/.test(text)) return clarification('claim_type_missing', '你想了解哪一類理賠的申請流程？目前還不能替你選定事故類型或申請管道。', ['住院醫療理賠', '門診醫療理賠', '其他理賠']);
  const namedService = /班機|航班|延誤|車禍|事故|過世|往生|保險|flight|boarding|accident|住院|門診|理賠|借款|借錢|地址|搬家|受益人|保費|付款|繳費|扣款|紅利|表單|申請書|密碼|保單|身故|死亡|戶政|醫起通|聯盟鏈|insurance|policy|claim|loan|address|beneficiary|form|password/i.test(text);
  if (!namedService && /不知道|不知|不清楚|不確定|忘記|要辦什麼|怎麼辦|幫我處理|not sure|don.t know/i.test(text)) return clarification('service_unspecified', '你想處理哪一類事情？請先選擇或描述需求，目前尚未選定任何服務。', ['醫療理賠資料準備', '保單資料變更', '查詢表單', '聯絡客服']);
  if (/(?:地址|搬家)/.test(text) && !/通訊|戶籍|收費/.test(text)) return clarification('address_type_missing', '你要變更通訊地址、戶籍地址，還是收費地址？以下先提供地址變更來源，辦理管道及條件仍需確認。', ['通訊地址', '戶籍地址', '收費地址'], false);
  if (/受益人/.test(text) && /變更|更改|修改|改受益人/.test(text) && !/身故|醫療|失能|表單|申請書|下載/.test(text)) return clarification('beneficiary_type_missing', '你要了解哪一類保險金的受益人變更？是否已發生保險事故、滿期及保單類型，仍需依來源與專員確認。', ['身故保險金受益人', '醫療／失能保險金受益人', '不確定類型'], false);
  if (topics.premium && /變更|更改|修改|改用|更換|換卡|change/.test(text) && !/效期|卡號|銀行轉帳|改轉帳|改用信用卡/.test(text)) return clarification('payment_details_missing', '是同一張信用卡更新卡號／效期，還是改用其他信用卡或銀行轉帳？以下來源不代表已確認適用條件。', ['同一張信用卡更新', '改用其他信用卡', '改用銀行轉帳'], false);
  return null;
}
