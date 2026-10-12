import { calculateStay, normalizeHospitalName, matchPartnerHospital } from '../../../../shared/hospitalization.js';
const normalized = value => value?.normalize('NFKC').toUpperCase().replace(/[\s/._-]/g, '');
const locations = { TOKYO: ['NRT', 'HND', '東京'], TAIPEI: ['TPE', 'TSA', '台北', '臺北'], TAIWAN: ['TPE', 'TSA', 'KHH', 'RMQ', 'TAIPEI', '台灣', '臺灣'] };
function locationKey(value) {
  const visible = value?.normalize('NFKC').toUpperCase() ?? '';
  const codes = [...new Set(visible.match(/\b(?:NRT|HND|TPE|TSA|KHH|RMQ)\b/g) ?? [])];
  if (codes.length === 1) return codes[0];
  for (const [pattern, key] of [[/\bTOKYO\b|東京/, 'TOKYO'], [/\bTAIPEI\b|台北|臺北/, 'TAIPEI'], [/\bTAIWAN\b|台灣|臺灣/, 'TAIWAN']]) if (pattern.test(visible)) return key;
  const key = normalized(value);
  return ({ 東京: 'TOKYO', 台北: 'TAIPEI', 臺北: 'TAIPEI', 台灣: 'TAIWAN', 臺灣: 'TAIWAN', NARITA: 'NRT', 成田: 'NRT', HANEDA: 'HND', 羽田: 'HND', TAOYUAN: 'TPE', 桃園: 'TPE' })[key] ?? key;
}
function sameLocation(left, right) {
  const a = locationKey(left); const b = locationKey(right);
  return a === b || Boolean(locations[a]?.map(normalized).includes(b) || locations[b]?.map(normalized).includes(a));
}
const specs = [
  ['flightNumber', 'FLIGHT_NUMBER_MISMATCH', '航班編號', (a, b) => normalized(a) === normalized(b)],
  ['departureDate', 'DEPARTURE_DATE_MISMATCH', '出發日期', (a, b) => a === b],
  ['origin', 'ORIGIN_MISMATCH', '出發地', sameLocation],
  ['destination', 'DESTINATION_MISMATCH', '目的地', sameLocation],
  ['passengerName', 'PASSENGER_NAME_MISMATCH', '旅客姓名', (a, b) => normalized(a) === normalized(b)],
];
export function checkEvidenceConsistency(documents, extractedData = {}) {
  const issues = [];
  const boarding = documents.find(doc => doc.documentType === 'boarding_pass');
  const delay = documents.find(doc => doc.documentType === 'delay_certificate');
  for (const [field, type, label, same] of specs) {
    const value = doc => field === 'departureDate' ? doc?.fields.departureDate ?? (/^\d{4}-\d{2}-\d{2}T/.test(doc?.fields.scheduledDeparture ?? '') ? doc.fields.scheduledDeparture.slice(0, 10) : null) : doc?.fields[field];
    if (value(boarding) && value(delay) && !same(value(boarding), value(delay))) {
      issues.push({ type, severity: 'high', message: `兩份文件的${label}不一致。`, documentIds: [boarding.id, delay.id] });
    }
    // Reported delay is approximate; only compare explicit incident date / route facts.
    const reported = extractedData[field === 'departureDate' ? 'incidentDate' : field];
    for (const doc of documents) if (reported && value(doc) && !same(reported, value(doc))) {
      issues.push({ type, severity: 'high', message: `文件${label}與先前提供的資訊不一致。`, documentIds: [doc.id] });
    }
  }
  const diagnosis = documents.find(doc => doc.documentType === 'diagnosis_certificate');
  const passbook = documents.find(doc => doc.documentType === 'bank_passbook');
  if (diagnosis?.fields.patientName && passbook?.fields.accountHolder && normalized(diagnosis.fields.patientName) !== normalized(passbook.fields.accountHolder)) {
    issues.push({ type: 'PATIENT_NAME_MISMATCH', severity: 'high', message: '診斷文件病患姓名與存摺戶名不一致，需要專員確認。', documentIds: [diagnosis.id, passbook.id] });
  }
  if (diagnosis) {
    const hospitalKey = name => matchPartnerHospital(name) ?? normalizeHospitalName(name);
    const comparisons = [
      ['hospitalName', 'HOSPITAL_NAME_MISMATCH', '醫院名稱', (a, b) => hospitalKey(a) === hospitalKey(b)],
      ['patientName', 'PATIENT_NAME_MISMATCH', '病患姓名', (a, b) => normalized(a) === normalized(b)],
      ['admissionDate', 'ADMISSION_DATE_MISMATCH', '入院日期', (a, b) => a === b],
      ['dischargeDate', 'DISCHARGE_DATE_MISMATCH', '出院日期', (a, b) => a === b],
    ];
    for (const [field, type, label, same] of comparisons) if (extractedData[field] && diagnosis.fields[field] && !same(extractedData[field], diagnosis.fields[field])) {
      issues.push({ type, severity: 'high', message: `診斷文件${label}與先前提供的資訊不一致。`, documentIds: [diagnosis.id] });
    }
    const stay = calculateStay(diagnosis.fields);
    if (stay.days && (extractedData.reportedInpatientDays && extractedData.reportedInpatientDays !== stay.days || stay.source === 'dates' && diagnosis.fields.reportedInpatientDays && diagnosis.fields.reportedInpatientDays !== stay.days)) {
      issues.push({ type: 'INPATIENT_DAYS_MISMATCH', severity: 'high', message: '住院日期與回報或文件明載的天數不一致，需要確認。', documentIds: [diagnosis.id] });
    }
  }
  return issues;
}
