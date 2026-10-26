// Valid single-page PDFs with synthetic facts only; no passenger PII or airline assets.
export function samplePdf(documentType) {
  const lines = documentType === 'diagnosis_certificate'
    ? ['NAVI SYNTHETIC HOSPITALIZATION PROOF', 'NOT A VALID MEDICAL DOCUMENT', 'Hospital: NAVI SYNTHETIC HOSPITAL', 'Patient: NAVI SYNTHETIC PATIENT', 'Admission: 2026-10-01', 'Discharge: 2026-10-05']
    : documentType === 'bank_passbook'
      ? ['NAVI SYNTHETIC BANK PASSBOOK', 'NOT A VALID BANK DOCUMENT', 'Bank: NAVI SYNTHETIC BANK', 'Holder: NAVI SYNTHETIC PATIENT', 'Account: ****1234']
    : documentType === 'boarding_pass'
    ? ['NAVI TEST - BOARDING PASS', 'SYNTHETIC SAMPLE - NOT VALID FOR TRAVEL', 'Passenger: NAVI TEST PASSENGER', 'Flight: BR 196', 'From: NRT (Tokyo)', 'To: TPE (Taipei)', 'Departure date: 2026-10-07', 'Scheduled departure: 14:20']
    : ['NAVI TEST - AIRLINE DELAY CERTIFICATE', 'SYNTHETIC SAMPLE - NOT AN OFFICIAL DOCUMENT', 'Flight: BR 196', 'From: NRT (Tokyo)', 'To: TPE (Taipei)', 'Departure date: 2026-10-07', 'Actual departure date: 2026-10-07', 'Scheduled departure: 14:20', 'Actual departure: 21:43'];
  return syntheticPdf(lines);
}

export function syntheticPdf(lines) {
  const escape = value => value.replace(/[\\()]/g, '\\$&');
  const stream = `BT /F1 16 Tf 48 750 Td 26 TL\n${lines.map(line => `(${escape(line)}) Tj T*`).join('\n')}\nET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}
