import { IntentDataSchema } from '../../../../shared/intelligence.js';
import fixtures from '../../../../knowledge/documents.json' with { type: 'json' };
import hospitalFixtures from '../../../../knowledge/hospital-documents.json' with { type: 'json' };
import { findHospitalMention, reportedStayDays, hasNegatedHospitalization } from '../../../../shared/hospitalization.js';

export function createDemoProvider() {
  return {
    mode: 'demo', requiresPaidTier: false,
    async understandTasks(message, signal) {
      const parts = message.split(/(?:，?也想|，?另外|；|;)/).map(part => part.trim()).filter(Boolean);
      const inputs = parts.length > 4 ? [message] : parts;
      return { tasks: await Promise.all(inputs.map(async input => ({ input, data: await this.understandIntent(input, signal) }))) };
    },
    async answerKnowledge(question, context) { return { answer: context.answer, confidence: 1, supported: true, sourceIds: context.sourceIds }; },
    // ponytail: scripted keyword demo only; use the existing live provider for actual language understanding.
    async understandIntent(message, signal) {
      signal?.throwIfAborted();
      const matches = [
        [/(?:flight|plane|airline|班機|航班|飛機).*(?:delay|延誤)|(?:delay|延誤).*(?:flight|plane|班機|航班|飛機)/i, 'flight_delay'],
        [/車禍|車輛事故|(?:car|vehicle).*(?:accident|crash)/i, 'vehicle_accident'],
        [/(?:換|變更|更改|修改|change|update).*(?:信用卡|扣款|繳費|payment|credit card)/i, 'payment_method_change'],
        [/搬家|moved (?:house|home)|(?:變更|更改|改|change|update).*(?:保單|受益人|地址|beneficiary|address)/i, 'policy_change'],
        [/住院|出院|inpatient|hospitali[sz]|admitted.{0,20}hospital|stayed.{0,30}hospital/i, 'hospitalization_claim'],
        [/保單資訊|查詢保單|保單借款|密碼|網路服務|policy information|policy loan|password/i, 'policy_information'],
      ].filter(([pattern]) => pattern.test(message));
      const serviceType = matches.length === 1 && !hasNegatedHospitalization(message) ? matches[0][1] : 'unknown';
      const hours = message.match(/(\d+(?:\.\d+)?|[一二兩三四五六七八九十百]+|seven)\s*(?:個)?(?:小時|hours?)/i)?.[1]?.toLowerCase();
      const values = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, seven: 7 };
      const minutes = hours ? Math.round((values[hours] ?? Number(hours)) * 60) : null;
      const flight = serviceType === 'flight_delay';
      const date = message.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null;
      return {
        intent: serviceType === 'unknown' ? 'unknown' : serviceType === 'policy_information' ? 'knowledge_query' : 'service_request', serviceType, confidence: serviceType === 'unknown' ? 0.2 : 0.94,
        summary: flight ? '使用者回報班機延誤，希望了解可處理的服務。' : serviceType === 'hospitalization_claim' ? '使用者住院後想了解如何申請醫療理賠。' : serviceType === 'unknown' ? '目前還需要補充想處理的事情。' : '使用者希望處理相關服務，目前僅提供需求辨識。',
        extractedData: { origin: flight && /Tokyo|東京/i.test(message) ? 'Tokyo' : null, destination: flight && /Taipei|台北/i.test(message) ? 'Taipei' : flight && /Taiwan|台灣/i.test(message) ? 'Taiwan' : null, delayMinutes: flight && Number.isFinite(minutes) && minutes <= 525600 ? minutes : null, incidentDate: IntentDataSchema.shape.extractedData.shape.incidentDate.safeParse(date).success ? date : null,
          ...(serviceType === 'hospitalization_claim' ? { hospitalName: findHospitalMention(message), reportedInpatientDays: reportedStayDays(message), admissionDate: null, dischargeDate: null, patientName: null } : {}),
        },
      };
    },
    async analyzeDocument({ documentType }, signal) {
      signal?.throwIfAborted();
      const fixture = hospitalFixtures[documentType] ?? fixtures[documentType];
      if (!fixture) return { documentType: 'unknown', confidence: 0.21, fields: {} };
      const fields = { ...fixture.fields };
      delete fields.originCode; delete fields.destinationCode;
      // Explicit demo target selects a fixture. Uploaded bytes are never represented as real recognition.
      return { documentType, confidence: fixture.confidence, fields };
    },
  };
}
