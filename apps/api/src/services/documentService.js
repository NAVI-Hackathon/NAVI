import { redactIdentifiers } from '../utils/privacy.js';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { DocumentAnalysisSchema, DocumentSchema, DOCUMENT_MIME_TYPES, MAX_DOCUMENT_BYTES } from '../../../../shared/journey.js';
import { ApiError } from '../middleware/errorHandler.js';
import { requestValidatedAI } from './providerRequest.js';
import { calculateDelayMinutes, documentVerified } from './documentValidationService.js';
import { calculateStay } from '../../../../shared/hospitalization.js';
export { calculateDelayMinutes, documentVerified } from './documentValidationService.js';

function matchesSignature(bytes, mime) {
  if (mime === 'application/pdf') return bytes.subarray(0, 5).toString() === '%PDF-';
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return mime === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
}
// Fast header checks precede the isolated production PDF/image decoder.
function completeContainer(bytes, mime) {
  if (mime === 'application/pdf') return /^%PDF-[12]\.\d/.test(bytes.subarray(0, 8).toString()) && bytes.subarray(-1024).includes(Buffer.from('%%EOF'));
  if (mime === 'image/jpeg') return bytes.length > 4 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (mime === 'image/webp') return bytes.length >= 20 && bytes.readUInt32LE(4) + 8 === bytes.length && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.subarray(12, 16).toString()) && bytes.readUInt32LE(16) <= bytes.length - 20;
  let imageData = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    const kind = bytes.subarray(offset + 4, offset + 8).toString();
    if (offset === 8 && (kind !== 'IHDR' || length !== 13 || bytes.readUInt32BE(offset + 8) === 0 || bytes.readUInt32BE(offset + 12) === 0)) return false;
    if (kind === 'IDAT' && length > 0) imageData = true;
    offset += length + 12;
    if (kind === 'IEND') return length === 0 && imageData && offset === bytes.length;
  }
  return false;
}
export async function parseUpload(req) {
  if (!req.is('multipart/form-data') || !Buffer.isBuffer(req.body)) throw new ApiError('INVALID_INPUT', '請以 multipart/form-data 提供文件。', 400);
  let form;
  try { form = await new Request('http://navi.local/upload', { method: 'POST', headers: { 'Content-Type': req.get('content-type') }, body: req.body }).formData(); }
  catch { throw new ApiError('INVALID_INPUT', '上傳格式不完整，請重新選擇文件。', 400); }
  const files = form.getAll('file');
  if ([...form.keys()].some(key => !['file', 'documentType'].includes(key)) || files.length !== 1 || !(files[0] instanceof File) || form.getAll('documentType').length > 1) throw new ApiError('INVALID_INPUT', '請提供一份文件與 documentType。', 400);
  const file = files[0];
  if (!file.size) throw new ApiError('EMPTY_DOCUMENT', '文件是空的，請重新選擇。', 400);
  if (file.size > MAX_DOCUMENT_BYTES) throw new ApiError('DOCUMENT_TOO_LARGE', '文件超過 10 MB，請選擇較小的文件。', 413);
  if (!DOCUMENT_MIME_TYPES.includes(file.type)) throw new ApiError('UNSUPPORTED_FILE_TYPE', '請選擇 PDF、PNG、JPG 或 WebP。', 415);
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    if (!matchesSignature(bytes, file.type)) throw new ApiError('UNSUPPORTED_FILE_TYPE', '文件內容與格式不符，請重新選擇。', 415);
    if (!completeContainer(bytes, file.type)) throw new ApiError('DOCUMENT_INVALID', '文件可能損壞或不完整，請重新選擇清晰的文件。', 422, true);
    const extensions = { 'application/pdf': /\.pdf$/i, 'image/png': /\.png$/i, 'image/jpeg': /\.jpe?g$/i, 'image/webp': /\.webp$/i };
    if (!extensions[file.type].test(file.name)) throw new ApiError('UNSUPPORTED_FILE_TYPE', '副檔名與文件格式不符，請選擇 PDF、PNG、JPG 或 WebP。', 415);
    const documentType = form.get('documentType');
    if (documentType !== null && typeof documentType !== 'string') throw new ApiError('INVALID_INPUT', '請提供有效的 documentType。', 400);
    if (documentType !== null && !DocumentAnalysisSchema.options.some(schema => schema.shape.documentType.value === documentType)) throw new ApiError('DOCUMENT_UNRECOGNIZED', '暫時無法辨識這份文件，請選擇符合服務需求的文件。', 422, true);
    const filename = file.name.replace(/\\/g, '/').split('/').at(-1).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || 'document';
    return { documentType, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), filename, mimeType: file.type, size: file.size };
  } catch (error) { bytes.fill(0); throw error; }
}
export async function analyzeDocument(upload, { provider, config, signal }) {
  if (!provider.analyzeDocument) throw new ApiError('DOCUMENT_INTELLIGENCE_NOT_AVAILABLE', '目前僅支援示範文件流程，真實文件辨識尚未開放。', 501, false);
  const analysis = await requestValidatedAI(async combined => DocumentAnalysisSchema.parse(await provider.analyzeDocument(upload, combined)), { config, signal });
  if (analysis.documentType === 'unknown') throw new ApiError('DOCUMENT_UNRECOGNIZED', '暫時無法辨識這份文件，請選擇清晰且符合服務需求的文件。', 422, true);
  const fields = { ...analysis.fields };
  for (const key of ['patientName', 'hospitalName', 'accountHolder', 'bankName']) {
    const value = fields[key];
    if (value && redactIdentifiers(value) !== value) fields[key] = null;
  }
  if (analysis.documentType === 'delay_certificate') fields.delayMinutes = calculateDelayMinutes(fields);
  if (analysis.documentType === 'diagnosis_certificate') {
    const stay = calculateStay(fields);
    fields.inpatientDays = stay.days; fields.inpatientDaysSource = stay.source;
    fields.diagnosis = null; // Clinical details are unnecessary for service navigation.
  }
  const verified = documentVerified({ ...analysis, fields }, config.journeyConfidenceThreshold,config.documentServiceType);
  const medical = ['diagnosis_certificate', 'bank_passbook'].includes(analysis.documentType);
  return DocumentSchema.parse({ ...(config.productMode ? { contentSha256: upload.sha256 ?? createHash('sha256').update(upload.bytes).digest('hex') } : {}), id: randomUUID(), ...analysis, fields, ...(config.productMode ? {missingFields:(analysis.documentType==='diagnosis_certificate'?['patientName','hospitalName','certificateKind',...(config.documentServiceType==='outpatient_claim'?['visitDate']:fields.inpatientDays===null?['admissionDate','dischargeDate']:[])]:analysis.documentType==='bank_passbook'?['accountHolder','bankName','accountLast4']:Object.keys(fields)).filter(key=>fields[key]==null),confidenceBasis:'uncalibrated_model_estimate'} : {}), verification: { scope: 'prototype_field_consistency', authenticity: 'not_assessed', eligibility: 'not_assessed' }, status: verified ? 'verified' : 'needs_review', matchedRequirements: verified ? [analysis.documentType] : [], filename: medical ? `${analysis.documentType}.${upload.mimeType === 'application/pdf' ? 'pdf' : 'image'}` : upload.filename, mimeType: upload.mimeType, size: upload.size, source: provider.mode === 'demo' ? 'demo' : 'live', isMock: provider.mode === 'demo' });
}
