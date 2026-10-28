import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { CredentialsSchema, HandoffDraftRequestSchema, TaskJourneyRequestSchema } from '../../../shared/product.js';

test('A3 machine-readable contract matches the runtime schemas and refuses ambiguous identities', () => {
  execFileSync(process.execPath, [new URL('../../../scripts/export-product-contract.js', import.meta.url).pathname, '--check']);
  assert.equal(CredentialsSchema.safeParse({ email: 'synthetic@example.invalid', password: 'synthetic-only-password' }).success, true);
  assert.equal(CredentialsSchema.safeParse({ email: 'synthetic@example.invalid', username: 'synthetic', password: 'synthetic-only-password' }).success, false);
  assert.equal(HandoffDraftRequestSchema.safeParse({ journeyVersion: 1, version: 0, text: '合成測試，尚未送出' }).success, true);
  assert.equal(TaskJourneyRequestSchema.safeParse({ taskId: 'other-owner-selected-by-client', idempotencyKey: 'not-a-uuid' }).success, false);
});
