import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import { createServer as createHttps, request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createOllamaTransport } from '../../../apps/api/src/ai/ollamaTransport.js';
import { createInferenceBroker } from './server.mjs';

async function bind(t, server, port = 0) {
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server.address().port;
}
const text = 'qwen3:4b-instruct-2507-q4_K_M';
const vision = 'qwen3.5:4b-q4_K_M';

test('isolated mTLS ingress verifies both peers, rejects management, and reconnects after a listener failure', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'navi-broker-mtls-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const openssl = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });
  function ca(name) {
    openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=' + name,
      '-keyout', name + '.key', '-out', name + '.crt');
  }
  function leaf(name, issuer, extensions) {
    const path = join(dir, name + '.ext');
    writeFileSync(path, extensions);
    openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=' + name, '-keyout', name + '.key', '-out', name + '.csr');
    openssl('x509', '-req', '-in', name + '.csr', '-CA', issuer + '.crt', '-CAkey', issuer + '.key',
      '-CAcreateserial', '-days', '1', '-extfile', path, '-out', name + '.crt');
    for (const ext of ['key', 'crt']) chmodSync(join(dir, name + '.' + ext), 0o600);
  }
  ca('server-ca'); ca('client-ca'); ca('wrong-ca');
  chmodSync(join(dir, 'server-ca.crt'), 0o600);
  leaf('navi-inference.internal', 'server-ca', 'subjectAltName=DNS:navi-inference.internal\nextendedKeyUsage=serverAuth');
  leaf('navi-client', 'client-ca', 'extendedKeyUsage=clientAuth');
  leaf('adrift-client', 'wrong-ca', 'extendedKeyUsage=clientAuth');

  const generated = [];
  const engine = await bind(t, createHttp(async (req, res) => {
    if (req.url === '/api/version') return res.end('{"version":"synthetic"}');
    if (req.url === '/api/ps') return res.end('{"models":[]}');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString());
    generated.push(data.model);
    res.end(JSON.stringify({ model: data.model, done: true, done_reason: 'stop', message: { role: 'assistant', content: 'test' } }));
  }));
  const token = 'n'.repeat(43);
  const broker = await bind(t, createInferenceBroker({ upstream: 'http://127.0.0.1:' + engine, clients: {
    adrift: { token: 'a'.repeat(43), text: [vision], vision: [], pending: 2, rpm: 8 },
    navi: { token, text: [text], vision: [vision], pending: 2, rpm: 8 },
  } }));
  const tls = {
    ca: readFileSync(join(dir, 'client-ca.crt')), cert: readFileSync(join(dir, 'navi-inference.internal.crt')),
    key: readFileSync(join(dir, 'navi-inference.internal.key')), requestCert: true, rejectUnauthorized: true,
  };
  const ingress = () => createHttps(tls, async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const reply = await fetch('http://127.0.0.1:' + broker + req.url, { method: req.method,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      res.writeHead(reply.status, Object.fromEntries(reply.headers));
      res.end(await reply.text());
    } catch { res.destroy(); }
  });
  const front = ingress(), port = await bind(t, front);
  const base = 'https://127.0.0.1:' + port;
  const client = (name = 'navi-client', serverName = 'navi-inference.internal') =>
    createOllamaTransport(base, { serverName, caPath: join(dir, 'server-ca.crt'),
      certPath: join(dir, name + '.crt'), keyPath: join(dir, name + '.key') }, { requireBroker: true });
  const send = client();
  const signal = () => AbortSignal.timeout(2500);
  await assert.rejects(new Promise((resolve, reject) => {
    const req = httpsRequest(base + '/api/version', { ca: readFileSync(join(dir, 'server-ca.crt')),
      servername: 'navi-inference.internal', signal: signal() }, response => { response.resume(); resolve(response.statusCode); });
    req.once('error', reject);
    req.end();
  }), /certificate required|handshake failure/i);
  await assert.rejects(client('adrift-client')('/api/version', { signal: signal() }));
  await assert.rejects(client('navi-client', 'bad.internal')('/api/version', { signal: signal() }), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  const version = await send('/api/version', { signal: signal() });
  assert.equal(version.status, 200);
  assert.equal(JSON.parse(version.body).version, 'synthetic');
  assert.equal((await send('/api/show', { payload: { model: 'qwen3:0.6b' }, signal: signal() })).status, 403);
  await assert.rejects(send('/api/pull', { signal: signal() }), /Invalid Ollama API path/);
  const image = readFileSync(new URL('../../../apps/api/eval/holdout/v2/fixtures/bank.png', import.meta.url)).toString('base64');
  for (const [model, images] of [[text, null], [vision, [image]]]) {
    const response = await send('/api/chat', { signal: signal(), payload: { model, stream: false,
      messages: [{ role: 'user', content: 'synthetic', ...(images ? { images } : {}) }] } });
    assert.equal(response.status, 200);
  }
  await new Promise(resolve => front.close(resolve));
  await assert.rejects(send('/api/version', { signal: signal() }), { code: 'ECONNREFUSED' });
  await bind(t, ingress(), port);
  assert.equal((await send('/api/version', { signal: signal() })).status, 200);
  assert.deepEqual(generated, [text, vision]);
});
