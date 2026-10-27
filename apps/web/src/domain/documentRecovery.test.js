import test from 'node:test';
import assert from 'node:assert/strict';
import { documentRecovery, unrecognizedFields } from './documentRecovery.js';

test('a bad file is chosen again; nothing is retried with the same file', () => {
  for (const code of ['EMPTY_DOCUMENT', 'DOCUMENT_TOO_LARGE', 'UNSUPPORTED_FILE_TYPE', 'DOCUMENT_INVALID']) assert.deepEqual(documentRecovery(code).actions, ['reselect'], code);
});

test('the wrong kind of document: choose again, or provide the information, or a specialist', () => {
  assert.deepEqual(documentRecovery('DOCUMENT_TYPE_MISMATCH').actions, ['reselect', 'manual', 'handoff']);
});

test('a timeout or network error offers the same file again (sent only when the user presses it)', () => {
  for (const code of ['AI_TIMEOUT', 'NETWORK_ERROR', 'RATE_LIMITED']) assert.equal(documentRecovery(code).actions[0], 'retry', code);
});

test('no recognition or no quota: never a retry loop, the information or a specialist instead', () => {
  for (const code of ['DOCUMENT_INTELLIGENCE_NOT_AVAILABLE', 'DOCUMENT_RECOGNITION_UNAVAILABLE', 'AI_DAILY_LIMIT_REACHED', 'AI_SESSION_LIMIT_REACHED']) {
    assert.ok(!documentRecovery(code).actions.includes('retry'), code);
    assert.ok(documentRecovery(code).actions.includes('manual'), code);
  }
});

test('an unknown failure still offers a way forward', () => {
  assert.ok(documentRecovery(undefined).actions.length > 0);
});

test('fields the recognition did not find are listed, not guessed', () => {
  assert.deepEqual(unrecognizedFields({ patientName: 'A', hospitalName: null, admissionDate: '' }, ['patientName', 'hospitalName', 'admissionDate', 'dischargeDate']), ['hospitalName', 'admissionDate', 'dischargeDate']);
});
