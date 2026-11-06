import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFileSync, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { BROKER_HEADER, BROKER_VERSION } from './ollamaBrokerProtocol.js';

const MAX_RESPONSE_BYTES = 128 * 1024;
const paths = new Set(['/api/chat', '/api/version', '/api/tags', '/api/show']);

export function ollamaOrigin(value, { requireTLS = false } = {}) {
  const match = /^https?:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/.exec(value);
  if (!match || match[0] !== value || Number(match[1]) > 65535 ||
      (requireTLS && !value.startsWith('https://'))) {
    throw new Error('OLLAMA_BASE_URL must use an explicit loopback origin; production requires HTTPS');
  }
  return new URL(value).origin;
}

function readPrivateFile(path) {
  if (!isAbsolute(path)) throw new Error('Ollama TLS files must use absolute paths');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) ||
      (stat.uid !== process.getuid() && stat.uid !== 0)) {
    throw new Error('Unsafe Ollama TLS file permissions or ownership');
  }
  return readFileSync(path);
}

export function createOllamaTransport(origin, tls = {}, { requireBroker = false } = {}) {
  const base = ollamaOrigin(origin);
  const secure = base.startsWith('https://');
  let tlsOptions = {};
  if (secure) {
    if (!tls.caPath || !tls.certPath || !tls.keyPath ||
        !/^[a-zA-Z0-9.-]{1,253}$/.test(tls.serverName || '')) {
      throw new Error('HTTPS Ollama requires CA, client certificate, key, and verified server name');
    }
    tlsOptions = {
      ca: readPrivateFile(tls.caPath),
      cert: readPrivateFile(tls.certPath),
      key: readPrivateFile(tls.keyPath),
      servername: tls.serverName,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    };
  }
  const send = (path, { payload, signal }) => new Promise((resolve, reject) => {
    if (!paths.has(path)) return reject(new Error('Invalid Ollama API path'));
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const req = (secure ? httpsRequest : httpRequest)(new URL(path, base), {
      agent: false, signal, method: body === undefined ? 'GET' : 'POST',
      ...tlsOptions,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const status = res.statusCode;
      if (requireBroker && res.headers[BROKER_HEADER] !== BROKER_VERSION) {
        res.destroy();
        reject(new Error('Shared Ollama broker was not verified'));
        return;
      }
      res.on('error', reject);
      // Redirects and every non-200 response fail closed; no external URL is followed.
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

  if (!requireBroker) return send;
  return async (path, options) => {
    // Confirm the authenticated endpoint is the broker before sending any prompt or image bytes.
    if (path === '/api/chat') {
      const check = await send('/api/version', { signal: options.signal });
      if (check.status !== 200) return check;
    }
    return send(path, options);
  };
}
