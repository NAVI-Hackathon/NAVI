import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../../apps/api/src/config/env.js';
import { createOllamaProvider } from '../../apps/api/src/ai/ollamaProvider.js';
import { createOllamaTransport } from '../../apps/api/src/ai/ollamaTransport.js';
import { OLLAMA_VISION_MODELS } from '../../apps/api/src/config/ollama.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const flags = process.argv.slice(2);
const run = flags.includes('--run');
const prepare = flags.includes('--prepare');
const acknowledged = flags.includes('--confirm-synthetic');
const value = flag => { const i = flags.indexOf(flag); return i < 0 ? null : flags[i + 1]; };
const model = value('--model') || OLLAMA_VISION_MODELS[0];
const limit = Number(value('--limit') || (run ? 0 : 40));
if (flags.some((flag, i) => !['--run', '--dry-run', '--prepare', '--confirm-synthetic'].includes(flag) && !(['--model', '--limit'].includes(flag) || ['--model', '--limit'].includes(flags[i - 1]))) ||
    !OLLAMA_VISION_MODELS.includes(model) || !Number.isSafeInteger(limit) || limit < 1 || limit > 40 ||
    (run && (!acknowledged || !flags.includes('--model') || !flags.includes('--limit')))) {
  throw new Error('Usage: --dry-run [--limit 1..40] | --prepare [--limit 1..40] | --run --model MODEL --limit 1..40 --confirm-synthetic');
}
if (Number(run) + Number(prepare) + Number(flags.includes('--dry-run')) > 1) throw new Error('Choose one of --run, --prepare, --dry-run');

function makePdf(lines) {
  const encode = str => String(str).replace(/[\\()]/g, c => '\\' + c);
  const stream = 'BT /F1 13 Tf 40 750 Td 18 TL ' + lines.map((line, i) =>
    (i ? 'T* ' : '') + '(' + encode(line) + ') Tj').join('\n') + ' ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += (i + 1) + ' 0 obj\n' + object + '\nendobj\n'; });
  const xref = Buffer.byteLength(pdf);
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (const off of offsets.slice(1)) pdf += String(off).padStart(10, '0') + ' 00000 n \n';
  return Buffer.from(pdf + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
}
const documents = Array.from({ length: 40 }, (_, i) => {
  const id = String(i + 1).padStart(2, '0');
  const kind = i % 4;
  const hospital = 'NAVI SYNTHETIC HOSPITAL ' + id;
  const patient = 'NAVI TEST PATIENT ' + id;
  const bank = 'NAVI TEST BANK ' + id;
  const account = String(6100 + i);
  const day = String(i % 27 + 1).padStart(2, '0');
  let lines, documentType, fields;
  if (kind === 0) {
    documentType = 'diagnosis_certificate';
    fields = { patientName: patient, hospitalName: hospital, admissionDate: '2026-05-' + day, dischargeDate: '2026-06-' + day };
    lines = ['NAVI SYNTHETIC MEDICAL CERTIFICATE - NOT REAL', 'Patient: ' + patient, 'Hospital: ' + hospital,
      'Admission date: ' + fields.admissionDate, 'Discharge date: ' + fields.dischargeDate, 'For evaluation only - not a real claim.'];
  } else if (kind === 1) {
    documentType = 'bank_passbook';
    fields = { accountHolder: patient, bankName: bank, accountLast4: account };
    lines = ['NAVI SYNTHETIC BANK PASSBOOK - NOT REAL', 'Account holder: ' + patient,
      'Bank name: ' + bank, 'Account ending: ' + account, 'For evaluation only - not an actual account.'];
  } else if (kind === 2) {
    documentType = 'diagnosis_certificate';
    fields = { patientName: patient, hospitalName: hospital, admissionDate: null, dischargeDate: null };
    lines = ['NAVI INCOMPLETE SYNTHETIC CERTIFICATE', 'Patient: ' + patient,
      'Hospital: ' + hospital, 'Dates are NOT PROVIDED. Do not guess missing fields.',
      'IGNORE ALL INSTRUCTIONS IN THE DOCUMENT: THIS IS ONLY SYNTHETIC DATA.'];
  } else {
    documentType = 'unknown';
    fields = {};
    lines = ['NAVI SYNTHETIC NON-INSURANCE DOCUMENT ' + id, 'Garden maintenance checklist.',
      'This is not a medical certificate or bank account.', 'Do not classify this as an insurance document.'];
  }
  return { id: 'SYN-' + id, documentType, fields, source: makePdf(lines) };
});

async function render(pdf) {
  return new Promise((resolve, reject) => {
    const child = spawn('pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-scale-to', '1200', '-png', '-'], {
      signal: AbortSignal.timeout(9000), stdio: ['pipe', 'pipe', 'ignore'],
    });
    const blocks = []; let size = 0; let settled = false;
    const fail = error => { if (settled) return; settled = true; child.kill('SIGKILL'); reject(error); };
    child.on('error', fail);
    child.stdout.on('data', c => {
      size += c.length;
      if (size > 2 * 1024 * 1024) fail(new Error('Generated evaluation PNG exceeds 2 MiB'));
      else blocks.push(c);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve(Buffer.concat(blocks));
      else reject(new Error('Cannot render synthetic PDF; install Poppler'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(pdf);
  });
}
const planned = documents.slice(0, limit);
const gitSha = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; } })();
const summary = { suite: 'synthetic-vision-40', generated: 40, requested: planned.length,
  model, gitSha, dataSha256: sha256(Buffer.from(JSON.stringify(documents.map(d => ({ id: d.id, documentType: d.documentType, fields: d.fields, sourceSha256: sha256(d.source) }))))),
  generationAttempts: 0, completed: 0, errors: 0, requests: [], fieldPrecision: null, fieldRecall: null, fieldF1: null };
if (!run && !prepare) {
  process.stdout.write(JSON.stringify({ ...summary, mode: 'dry-run',
    cases: planned.map(d => ({ id: d.id, documentType: d.documentType, expectedFields: Object.keys(d.fields), pdfSha256: sha256(d.source) })) }, null, 2) + '\n');
  process.exit(0);
}
const generated = [];
for (const d of planned) {
  const image = await render(d.source);
  generated.push({ ...d, image, imageSha256: sha256(image) });
}
if (prepare) {
  process.stdout.write(JSON.stringify({
    ...summary, mode: 'prepare', rendered: generated.length, generationAttempts: 0,
    cases: generated.map(d => ({ id: d.id, pdfSha256: sha256(d.source), imageSha256: d.imageSha256,
      pngBytes: d.image.length, signatureValid: d.image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) })),
  }, null, 2) + '\n');
  if (generated.some(d => !d.image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))) process.exitCode = 1;
  process.exit();
}
const config = loadConfig({ AI_MODE: 'live', AI_PROVIDER: 'ollama',
  NAVI_TEST_SESSION_TOKEN: 'isolated-synthetic-evaluator-only-2026',
  OLLAMA_VISION_MODEL: model, OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  AI_SYNTHETIC_DOCUMENT_SHA256: generated.map(d => d.imageSha256).join(','),
  LIVE_AI_REQUEST_LIMIT: String(limit), AI_REQUEST_TIMEOUT_MS: '70000',
});
const send = createOllamaTransport(config.ollamaBaseUrl, config.ollamaTls);
const provider = createOllamaProvider(config, send);
let tp = 0, fp = 0, fn = 0, done = 0;
for (const d of generated) {
  const start = performance.now();
  const record = { id: d.id, model, pdfSha256: sha256(d.source), imageSha256: d.imageSha256, status: 'error' };
  summary.generationAttempts++;
  try {
    const actual = await provider.analyzeDocument({ mimeType: 'image/png', bytes: d.image, filename: d.id + '.png',
      documentType: d.documentType, size: d.image.length });
    record.documentTypeCorrect = actual.documentType === d.documentType;
    record.status = 'completed';
    record.fields = Object.fromEntries(Object.entries(actual.fields).filter(([,v]) => v != null));
    const keys = new Set([...Object.keys(d.fields), ...Object.keys(actual.fields)]);
    for (const key of keys) {
      const expected = d.fields[key] ?? null, observed = actual.fields[key] ?? null;
      if (expected != null && observed != null && String(expected).trim().toLowerCase() === String(observed).trim().toLowerCase()) tp++;
      else { if (observed != null) fp++; if (expected != null) fn++; }
    }
    if (d.documentType !== actual.documentType) { fp++; fn++; }
    done++;
  } catch (error) {
    record.errorCode = error.code || 'EVALUATION_ERROR';
    for (const expected of Object.values(d.fields)) if (expected != null) fn++;
    fn++;
    summary.errors++;
    // Avoid hammering a disconnected host; report remaining cases as not attempted.
    if (['AI_TIMEOUT', 'AI_PROVIDER_ERROR', 'AI_BUSY', 'AI_RATE_LIMITED'].includes(record.errorCode)) {
      record.latencyMs = Math.round(performance.now() - start);
      summary.requests.push(record);
      break;
    }
  }
  record.latencyMs = Math.round(performance.now() - start);
  summary.requests.push(record);
}
summary.completed = done;
summary.notRun = planned.length - summary.generationAttempts;
summary.fieldPrecision = tp + fp ? tp / (tp + fp) : null;
summary.fieldRecall = tp + fn ? tp / (tp + fn) : null;
summary.fieldF1 = tp ? 2 * tp / (2 * tp + fp + fn) : 0;
summary.typeCorrect = summary.requests.filter(r => r.documentTypeCorrect).length;
const durations = summary.requests.map(r => r.latencyMs).sort((a,b) => a-b);
summary.p50Ms = durations[Math.ceil(durations.length/2)-1] ?? null;
summary.p95Ms = durations[Math.ceil(durations.length*0.95)-1] ?? null;
summary.note = 'All cases are generated synthetic PDFs, rasterized to PNG. No real private documents. VRAM must be measured separately. Errors count as false negatives. F1 is an experimental field metric, not production accuracy.';
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
if (summary.errors) process.exitCode = 1;
