export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 2_000_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngSize(bytes) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  let foundData = false;
  for (let offset = 33; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    offset += length + 12;
    if (offset > bytes.length || ['IHDR', 'acTL', 'fcTL', 'fdAT'].includes(kind)) return null;
    if (kind === 'IDAT' && length) foundData = true;
    if (kind === 'IEND') {
      if (length || offset !== bytes.length || !foundData) return null;
      return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    }
  }
  return null;
}

function webpSize(bytes) {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
  let canvas, image;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + length + (length & 1) > bytes.length || ['ANIM', 'ANMF'].includes(kind)) return null;
    if (kind === 'VP8X') {
      if (offset !== 12 || length !== 10 || bytes[data] & 2) return null;
      canvas = [1 + bytes.readUIntLE(data + 4, 3), 1 + bytes.readUIntLE(data + 7, 3)];
    }
    if (kind === 'VP8L' || kind === 'VP8 ') {
      if (image) return null;
      if (kind === 'VP8L' && length > 5 && bytes[data] === 0x2f) {
        image = [1 + (bytes[data + 1] | (bytes[data + 2] & 0x3f) << 8),
          1 + ((bytes[data + 2] >> 6) | bytes[data + 3] << 2 | (bytes[data + 4] & 0x0f) << 10)];
      } else if (kind === 'VP8 ' && length > 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 1 && bytes[data + 5] === 0x2a) {
        image = [bytes.readUInt16LE(data + 6) & 0x3fff, bytes.readUInt16LE(data + 8) & 0x3fff];
      } else return null;
    }
    offset = data + length + (length & 1);
    if (offset === bytes.length && image && (!canvas || canvas.every((n, i) => n === image[i]))) return image;
  }
  return null;
}

function dimensions(bytes, mime) {
  if (mime === 'image/png') return pngSize(bytes);
  if (mime === 'image/webp') return webpSize(bytes);
  if (mime === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.readUInt16BE(bytes.length - 2) === 0xffd9) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i++] !== 0xff) break;
      let marker = bytes[i++];
      while (marker === 0xff && i < bytes.length) marker = bytes[i++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      const length = bytes.readUInt16BE(i);
      if (length < 2 || i + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        return [bytes.readUInt16BE(i + 5), bytes.readUInt16BE(i + 3)];
      }
      i += length;
    }
  }
  return null;
}
export function isOllamaImage(bytes, mime) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_IMAGE_BYTES) return false;
  const size = dimensions(bytes, mime);
  return Boolean(size?.[0] && size[1] && size[0] * size[1] <= MAX_IMAGE_PIXELS);
}
