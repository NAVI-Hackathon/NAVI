import { describeHospitalStay } from '../../../../shared/hospitalization.js';
// Display formatting for zh-TW. Pure functions only.

export function dateText(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? '');
  return match ? `${match[1]} / ${match[2]} / ${match[3]}` : '待確認';
}

/** Calendar span only; not confirmed medical or benefit days. */
export function stayDays(admissionDate, dischargeDate) {
  return describeHospitalStay({ admissionDate, dischargeDate }).calendarDays;
}

export function stayText(admissionDate, dischargeDate) {
  return admissionDate && dischargeDate ? `${dateText(admissionDate)} – ${dateText(dischargeDate)}` : '待確認';
}

export const maskAccount = last4 => (last4 ? `＊＊＊＊ ${last4}` : '待確認');
