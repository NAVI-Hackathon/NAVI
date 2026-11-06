import { readFileSync, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createInferenceBroker } from './server.mjs';

function start() {
  const path = process.argv[2];
  if (process.argv.length !== 3 || !isAbsolute(path)) throw new Error('Provide an absolute credential file path');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > 8192 || stat.mode & 0o077 ||
      ![0, process.getuid()].includes(stat.uid)) throw new Error('Unsafe credential file');
  const clients = JSON.parse(readFileSync(path, 'utf8'));
  const broker = createInferenceBroker({ clients, log: event => console.log(JSON.stringify(event)) });
  broker.maxConnections = 24;
  broker.once('error', () => { console.error('Broker could not listen on loopback'); process.exitCode = 1; });
  broker.listen(11437, '127.0.0.1');
  // Wait for an active generation and its unload guard before leaving the single slot.
  const stop = () => broker.close();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

try { start(); }
catch { console.error('Invalid inference broker configuration'); process.exitCode = 1; }
