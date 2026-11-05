import { request } from 'node:http';

const MAX_RESPONSE_BYTES = 128 * 1024;
const paths = new Set(['/api/chat', '/api/version', '/api/tags', '/api/show']);

export function ollamaOrigin(value) {
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/.exec(value);
  if (!match || match[0] !== value || Number(match[1]) > 65535) throw new Error('OLLAMA_BASE_URL must be an explicit HTTP IPv4 loopback origin');
  return new URL(value).origin;
}

export function createOllamaTransport(origin) {
  const base = ollamaOrigin(origin);
  return (path, { payload, signal }) => new Promise((resolve, reject) => {
    if (!paths.has(path)) return reject(new Error('Invalid Ollama API path'));
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const req = request(new URL(path, base), {
      agent: false, signal, method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const status = res.statusCode;
      res.on('error', reject);
      if (status !== 200) {
        resolve({ status });
        res.destroy();
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) res.destroy(new Error('Ollama response exceeds size limit'));
        else chunks.push(chunk);
      });
      res.on('end', () => {
        if (!res.complete) reject(new Error('Incomplete Ollama response'));
        else resolve({ status, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
