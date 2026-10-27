import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HostMessageSchema, NaviMessageSchema, hostMessage, isAllowedOrigin, naviMessage, originOf, parseAllowedOrigins, readMessage,
} from '../../../../shared/embed.js';
import { claimDestinations } from './journeyEngine.js';

const parent = { name: 'parent window' };
const stranger = { name: 'other window' };
const allowedOrigins = parseAllowedOrigins('http://127.0.0.1:3000');
const event = (origin, data, source = parent) => ({ origin, data, source });

test('allowed origins are parsed strictly from configuration', () => {
  assert.deepEqual(parseAllowedOrigins('http://127.0.0.1:3000, https://mock.example.com'), ['http://127.0.0.1:3000', 'https://mock.example.com']);
  assert.deepEqual(parseAllowedOrigins('*, javascript:alert(1), https://mock.example.com/path, not a url'), []);
  assert.deepEqual(parseAllowedOrigins(''), []);
  assert.deepEqual(parseAllowedOrigins(undefined), []);
  assert.equal(originOf('http://127.0.0.1:5173/embed?mode=demo'), 'http://127.0.0.1:5173');
  assert.equal(originOf('not a url'), null);
});

test('origin check is an exact match: no wildcard, no "null", no look-alikes', () => {
  assert.equal(isAllowedOrigin('http://127.0.0.1:3000', allowedOrigins), true);
  for (const origin of ['http://127.0.0.1:3001', 'http://localhost:3000', 'https://127.0.0.1:3000', 'http://127.0.0.1:3000.evil.com', 'null', '', undefined]) {
    assert.equal(isAllowedOrigin(origin, allowedOrigins), false, String(origin));
  }
});

test('host messages are accepted only from the allowed origin and the expected window', () => {
  const read = e => readMessage(e, { allowedOrigins, expectedSource: parent, schema: HostMessageSchema });
  assert.deepEqual(read(event('http://127.0.0.1:3000', hostMessage('host:hello'))), hostMessage('host:hello'));
  assert.equal(read(event('https://evil.example', hostMessage('host:hello'))), null);
  assert.equal(read(event('http://127.0.0.1:3000', hostMessage('host:hello'), stranger)), null);
  assert.equal(read(event('http://127.0.0.1:3000', { ...hostMessage('host:hello'), extra: 1 })), null);
  assert.equal(read(event('http://127.0.0.1:3000', { type: 'host:hello' })), null);
  assert.equal(read(event('http://127.0.0.1:3000', 'host:hello')), null);
});

test('navigate messages carry only internal mock-site paths and kebab-case anchors', () => {
  const read = destination => readMessage(event('http://127.0.0.1:3000', naviMessage('navi:navigate', { destination })), { allowedOrigins, expectedSource: parent, schema: NaviMessageSchema });
  const valid = claimDestinations.form;
  assert.deepEqual(read(valid).destination, valid);
  for (const path of ['https://evil.example/x', '//evil.example/x', 'javascript:alert(1)', 'services/claims', '/services/../../etc', '/Services']) {
    assert.equal(read({ ...valid, path }), null, path);
  }
  for (const anchor of ['Form Claim', '"]<script>', 'a--b', '-a']) assert.equal(read({ ...valid, anchor }), null, anchor);
  assert.equal(read({ ...valid, source: { ...valid.source, url: 'https://evil.example/zh/a314' } }), null);
});

test('messages are rejected before the expected window exists, even from an allowed origin', () => {
  for (const [schema, data] of [[HostMessageSchema, hostMessage('host:hello')], [NaviMessageSchema, naviMessage('navi:ready')], [NaviMessageSchema, naviMessage('navi:navigate', { destination: claimDestinations.form })]]) {
    for (const expectedSource of [null, undefined]) {
      for (const source of [parent, stranger, null]) {
        assert.equal(readMessage(event('http://127.0.0.1:3000', data, source), { allowedOrigins, expectedSource, schema }), null);
      }
    }
    assert.deepEqual(readMessage(event('http://127.0.0.1:3000', data), { allowedOrigins, expectedSource: parent, schema }), data);
  }
});

test('the host answers a navigation with its id and found / missing only', () => {
  const read = data => readMessage(event('http://127.0.0.1:3000', data), { allowedOrigins, expectedSource: parent, schema: HostMessageSchema });
  for (const status of ['found', 'missing']) assert.deepEqual(read(hostMessage('host:navigated', { id: 3, status })), hostMessage('host:navigated', { id: 3, status }));
  for (const bad of [{ id: 3, status: 'maybe' }, { id: 0, status: 'found' }, { id: '3', status: 'found' }, { status: 'found' }, { id: 3, status: 'found', label: 'x' }]) {
    assert.equal(read(hostMessage('host:navigated', bad)), null, JSON.stringify(bad));
  }
  const navigate = readMessage(event('http://127.0.0.1:3000', naviMessage('navi:navigate', { destination: claimDestinations.form, id: 3 })), { allowedOrigins, expectedSource: parent, schema: NaviMessageSchema });
  assert.equal(navigate.id, 3);
});
