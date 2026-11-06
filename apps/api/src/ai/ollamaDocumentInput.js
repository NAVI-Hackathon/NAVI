import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ApiError } from '../middleware/errorHandler.js';
import { isOllamaImage, MAX_IMAGE_BYTES } from './ollamaImages.js';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 2;
const MAX_EXTRACTED_TEXT = 16 * 1024;

function deny(message = '這份合成文件超出本地安全辨識範圍，請改用手動資訊。') {
  return new ApiError('DOCUMENT_INTELLIGENCE_NOT_AVAILABLE', message, 422, false);
}

function checkedImage(bytes, mime) {
  if (!isOllamaImage(bytes, mime)) {
    throw deny('這張圖片的大小、解析度或格式不符合本地辨識限制，請使用清晰且較小的合成影像。');
  }
  return bytes;
}

function poppler(command, args, bytes, { signal, maxOutputBytes = MAX_EXTRACTED_TEXT, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const limit = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([limit, signal]) : limit;
    let child;
    try { child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'], signal: combined }); }
    catch { reject(deny('PDF 解碼工具目前無法使用。')); return; }
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(deny('PDF 解析逾時、格式錯誤或超出安全限制。'));
    };
    child.on('error', fail);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > maxOutputBytes) fail();
      else chunks.push(chunk);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      if (code !== 0 || combined.aborted) reject(deny());
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}

// Never infer that a file is synthetic from its filename or uploaded form fields.
export async function prepareOllamaDocument(upload, allowedHashes, signal) {
  const { bytes, mimeType } = upload;
  if (!Buffer.isBuffer(bytes) || !allowedHashes.has(createHash('sha256').update(bytes).digest('hex'))) {
    throw new ApiError('DOCUMENT_NOT_SYNTHETIC', '本地模型只允許已核對 SHA-256 指紋的合成文件。', 422, false);
  }
  if (mimeType !== 'application/pdf') {
    return { text: '請依圖片中真正可見的資料抽取欄位。', media: [checkedImage(bytes, mimeType)], kind: 'image' };
  }
  if (bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 5).toString() !== '%PDF-') throw deny();
  const info = (await poppler('pdfinfo', ['-'], bytes, { signal, maxOutputBytes: 8192 })).toString('utf8');
  const pages = Number(/^Pages:\s*(\d+)$/m.exec(info)?.[1]);
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > MAX_PDF_PAGES) throw deny('PDF 頁數超過目前的安全辨識上限（2 頁）。');
  const text = (await poppler('pdftotext', ['-f', '1', '-l', String(pages), '-layout', '-', '-'], bytes, { signal })).toString('utf8').replace(/\x00/g, '').trim();
  if (text.length >= 80) return { text: '以下是從合成 PDF 文字層擷取的原文，不代表內容真實。只抽取原文明確載明的欄位：\n' + text.slice(0, MAX_EXTRACTED_TEXT), media: null, kind: 'text_pdf' };
  const media = [];
  for (let page = 1; page <= pages; page++) {
    const png = await poppler('pdftoppm', ['-f', String(page), '-l', String(page), '-scale-to', '1200', '-singlefile', '-png', '-'], bytes, { signal, maxOutputBytes: MAX_IMAGE_BYTES });
    media.push(checkedImage(png, 'image/png'));
  }
  return { text: '這是合成掃描 PDF 的影像。只根據可見內容抽取欄位，模糊或缺漏填 null。', media, kind: 'scanned_pdf' };
}
