import { DocumentAnalysisSchema } from '../../../../shared/journey.js';
import { calculateStay } from '../../../../shared/hospitalization.js';
const clock = /^([01]\d|2[0-3]):([0-5]\d)$/;
export function calculateDelayMinutes(fields) {
  const { scheduledDeparture, actualDeparture, departureDate, actualDepartureDate } = fields;
  if (!scheduledDeparture || !actualDeparture) return null;
  let minutes;
  if (clock.test(scheduledDeparture) && clock.test(actualDeparture)) {
    const value = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const days = actualDepartureDate && departureDate ? (Date.parse(actualDepartureDate) - Date.parse(departureDate)) / 86400000 : 0;
    // Never silently assume an overnight delay from clock times alone.
    minutes = days * 1440 + value(actualDeparture) - value(scheduledDeparture);
  } else if (!clock.test(scheduledDeparture) && !clock.test(actualDeparture)) {
    minutes = (Date.parse(actualDeparture) - Date.parse(scheduledDeparture)) / 60000;
  }
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 525600 ? Math.round(minutes) : null;
}
export function travelInformationComplete(document) {
  return document?.documentType === 'boarding_pass' && ['passengerName', 'flightNumber', 'origin', 'destination', 'departureDate'].every(key => Boolean(document.fields[key]));
}
export function documentVerified(document, threshold) {
  if (document.requiresRevalidation) return false;
  if (!DocumentAnalysisSchema.safeParse({ documentType: document.documentType, confidence: document.confidence, fields: document.fields }).success) return false;
  const fields = document.fields;
  const sufficient = document.documentType === 'boarding_pass'
    ? Boolean(fields.flightNumber || (fields.origin && fields.destination))
    : document.documentType === 'delay_certificate' ? calculateDelayMinutes(fields) !== null
      : document.documentType === 'diagnosis_certificate' ? Boolean(['diagnosis_certificate', 'hospitalization_proof'].includes(fields.certificateKind) && fields.patientName && fields.hospitalName && calculateStay(fields).days !== null && (!fields.admissionDate || !fields.dischargeDate || !fields.reportedInpatientDays || calculateStay(fields).days === fields.reportedInpatientDays))
        : document.documentType === 'bank_passbook' && Boolean(fields.accountHolder && fields.bankName && /^\d{4}$/.test(fields.accountLast4 ?? ''));
  return Boolean(sufficient && document.confidence >= threshold);
}
