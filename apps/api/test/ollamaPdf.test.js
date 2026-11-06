import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaProvider } from '../src/ai/ollamaProvider.js';
import { loadConfig } from '../src/config/env.js';
import { prepareOllamaDocument } from '../src/ai/ollamaDocumentInput.js';
import { validateMedia } from '../src/services/mediaValidationService.js';
import { isOllamaImage } from '../src/ai/ollamaImages.js';

const toolsAvailable = ['pdfinfo', 'pdftotext', 'pdftoppm'].every(command =>
  spawnSync(command, ['-v'], { stdio: 'ignore' }).status === 0);
const options = { skip: toolsAvailable ? false : 'Install Poppler to run the real PDF preprocessing tests' };
const diagnosis = readFileSync(new URL('../eval/holdout/v2/fixtures/diagnosis.pdf', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const prepare = (bytes, signal) => prepareOllamaDocument({ bytes, mimeType: 'application/pdf' }, new Set([hash(bytes)]), signal);

function syntheticScan(count) {
  const pages = Array.from({ length: count }, (_, i) => 5 + i);
  const image = '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\nZ\nendstream';
  const draw = 'q 300 0 0 300 30 30 cm /Im0 Do Q';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [' + pages.map(id => id + ' 0 R').join(' ') + '] /Count ' + count + ' >>',
    image, '<< /Length ' + draw.length + ' >>\nstream\n' + draw + '\nendstream',
    ...pages.map(() => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << /XObject << /Im0 3 0 R >> >> /Contents 4 0 R >>'),
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += (i + 1) + ' 0 obj\n' + object + '\nendobj\n'; });
  const xref = Buffer.byteLength(pdf);
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (const offset of offsets) pdf += String(offset).padStart(10, '0') + ' 00000 n \n';
  return Buffer.from(pdf + 'trailer\n<< /Root 1 0 R /Size ' + (objects.length + 1) + ' >>\nstartxref\n' + xref + '\n%%EOF\n');
}

test('Poppler reads approved text PDFs without sending an image', options, async () => {
  const result = await prepare(diagnosis);
  assert.equal(result.kind, 'text_pdf');
  assert.equal(result.media, null);
  assert.match(result.text, /NAVI EVAL PERSON A/);
});

test('Poppler rasterizes both pages of an approved image-only PDF', options, async () => {
  const result = await prepare(syntheticScan(2));
  assert.equal(result.kind, 'scanned_pdf');
  assert.equal(result.media.length, 2);
  assert.ok(result.media.every(bytes => isOllamaImage(bytes, 'image/png')));
});

test('oversized, malformed, excessive-page and cancelled PDFs fail before inference', options, async () => {
  const oversize = Buffer.alloc(10 * 1024 * 1024 + 1);
  diagnosis.copy(oversize);
  for (const bytes of [oversize, Buffer.from('%PDF-1.4\nInvalid\n%%EOF\n'), syntheticScan(3)]) {
    await assert.rejects(prepare(bytes), { code: 'DOCUMENT_INTELLIGENCE_NOT_AVAILABLE' });
  }
  await assert.rejects(prepare(diagnosis, AbortSignal.abort()), { code: 'DOCUMENT_INTELLIGENCE_NOT_AVAILABLE' });
  await assert.rejects(prepare(syntheticScan(2), AbortSignal.timeout(5)), { code: 'DOCUMENT_INTELLIGENCE_NOT_AVAILABLE' });
  await assert.rejects(prepareOllamaDocument({ bytes: diagnosis, mimeType: 'application/pdf' }, new Set()),
    { code: 'DOCUMENT_NOT_SYNTHETIC' });
});

test('unapproved Ollama uploads are rejected before qpdf or decoding', async () => {
  const bytes = Buffer.from(diagnosis);
  const upload = { bytes, mimeType: 'application/pdf', sha256: hash(bytes) };
  let parserCalls = 0;
  await assert.rejects(validateMedia(upload, { aiProvider: 'ollama', productMode: true, production: true,
    syntheticDocumentHashes: [] }, undefined, async () => { parserCalls++; }), { code: 'DOCUMENT_NOT_SYNTHETIC' });
  assert.equal(parserCalls, 0);
});

test('text PDF wire dates require decimal ISO digits and still undergo schema validation', options, async () => {
  const config = loadConfig({ AI_MODE:'live', AI_PROVIDER:'ollama', NAVI_TEST_SESSION_TOKEN:'synthetic-token'.repeat(3),
    AI_SYNTHETIC_DOCUMENT_SHA256:hash(diagnosis) });
  const provider = createOllamaProvider(config, async (_path, { payload }) => {
    const dates = payload.format.properties.fields.properties;
    for (const field of ['admissionDate','dischargeDate','visitDate']) {
      const regex = new RegExp(dates[field].anyOf.find(value=>value.pattern).pattern);
      assert.equal(regex.test('2026-08-06'),true);
      assert.equal(regex.test('2026-08-_6'),false);
    }
    return {status:200,body:JSON.stringify({model:payload.model,done:true,done_reason:'stop',
      message:{role:'assistant',content:JSON.stringify({documentType:'diagnosis_certificate',confidence:.9,
        fields:{admissionDate:'2026-08-03',dischargeDate:'2026-08-_6'}})}})};
  });
  await assert.rejects(provider.analyzeDocument({bytes:diagnosis,mimeType:'application/pdf'}),{code:'AI_RESPONSE_INVALID'});
});
