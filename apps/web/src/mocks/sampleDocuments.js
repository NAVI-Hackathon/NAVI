// Synthetic one-page PDFs for the 「使用範例…」 buttons in formal mode. The facts are fictional and
// marked as such; they mirror apps/api/test/sampleDocuments.js so both apps show the same demo data.
const LINES = {
  diagnosis_certificate: ['NAVI SYNTHETIC HOSPITALIZATION PROOF', 'NOT A VALID MEDICAL DOCUMENT', 'Hospital: NAVI SYNTHETIC HOSPITAL', 'Patient: NAVI SYNTHETIC PATIENT', 'Admission: 2026-10-01', 'Discharge: 2026-10-05'],
  bank_passbook: ['NAVI SYNTHETIC BANK PASSBOOK', 'NOT A VALID BANK DOCUMENT', 'Bank: NAVI SYNTHETIC BANK', 'Holder: NAVI SYNTHETIC PATIENT', 'Account: ****1234'],
};

export function samplePdfFile(documentType) {
  const lines = LINES[documentType];
  if (!lines) throw new Error(`No sample document for ${documentType}`);
  const escape = value => value.replace(/[\\()]/g, '\\$&');
  const stream = `BT /F1 16 Tf 48 750 Td 26 TL\n${lines.map(line => `(${escape(line)}) Tj T*`).join('\n')}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  // ASCII only, so string length equals byte length for the xref offsets.
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new File([pdf], `${documentType}-sample.pdf`, { type: 'application/pdf' });
}
