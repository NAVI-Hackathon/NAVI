import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';

test('only explicitly enabled loopback proxies can forward client identities', () => {
  const base = loadConfig({ AI_MODE: 'demo' });
  assert.equal(createApp(base).get('trust proxy'), false);
  const app = createApp(loadConfig({ AI_MODE: 'demo', TRUST_PROXY_LOOPBACK: 'true' }));
  const trust = app.get('trust proxy fn');
  assert.equal(trust('127.0.0.1'), true);
  assert.equal(trust('203.0.113.10'), false);
});
