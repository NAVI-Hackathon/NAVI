import test from 'node:test';
import assert from 'node:assert/strict';
import { describeHospitalStay } from '../../../shared/hospitalization.js';
import { analyzeDocument } from '../src/services/documentService.js';
import { loadConfig } from '../src/config/env.js';
import { samplePdf } from './sampleDocuments.js';

test('Hospital calendar span is UTC date arithmetic, separate from printed days', () => {
  for (const [admissionDate, dischargeDate, days] of [['2026-10-01', '2026-10-05', 5], ['2026-01-31', '2026-02-01', 2], ['2026-12-31', '2027-01-01', 2], ['2026-10-01', '2026-10-01', 1], ['2024-02-28', '2024-03-01', 3]]) {
    for (const TZ of ['UTC', 'Asia/Taipei', 'America/Los_Angeles']) {
      const before = process.env.TZ;
      try { process.env.TZ = TZ; assert.deepEqual(describeHospitalStay({ admissionDate, dischargeDate }), { calendarDays: days, nights: days - 1, reportedDays: null, requiresConfirmation: true }); }
      finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
    }
  }
  for (const fields of [{}, { admissionDate: '2026-10-01' }, { admissionDate: '2026-02-30', dischargeDate: '2026-03-02' }, { admissionDate: '2026-10-05', dischargeDate: '2026-10-01' }, { admissionDate: '2026-10-01T23:00:00+08:00', dischargeDate: '2026-10-05' }]) assert.equal(describeHospitalStay(fields).calendarDays, null);
  assert.deepEqual(describeHospitalStay({ reportedInpatientDays: 4 }), { calendarDays: null, nights: null, reportedDays: 4, requiresConfirmation: false });
  assert.equal(describeHospitalStay({ admissionDate: '2026-10-01', dischargeDate: '2026-10-05', reportedInpatientDays: 4 }).requiresConfirmation, true);
});

test('Document API preserves date evidence without inventing printed hospital days', async () => {
  const buffer = samplePdf('diagnosis_certificate');
  const provider = { mode: 'live', analyzeDocument: async () => ({ documentType: 'diagnosis_certificate', confidence: 0.97, fields: { patientName: 'NAVI SYNTHETIC PATIENT', hospitalName: 'NAVI SYNTHETIC HOSPITAL', admissionDate: '2026-10-01', dischargeDate: '2026-10-05', diagnosis: null, certificateKind: 'hospitalization_proof', reportedInpatientDays: null } }) };
  const document = await analyzeDocument({ buffer, size: buffer.length, mimeType: 'application/pdf', filename: 'synthetic.pdf' }, { provider, config: loadConfig({ AI_MODE: 'demo' }) });
  assert.equal(document.fields.inpatientDays, 5); // Legacy calendar span remains compatible.
  assert.deepEqual(document.stay, { calendarDays: 5, nights: 4, reportedDays: null, requiresConfirmation: true });
  assert.equal(document.isMock, false);
  assert.equal(document.verification.authenticity, 'not_assessed');
});
