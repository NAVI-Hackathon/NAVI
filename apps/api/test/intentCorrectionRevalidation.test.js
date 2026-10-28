import test from 'node:test';
import assert from 'node:assert/strict';
import { createJourneyService } from '../src/services/journeyService.js';
import { createDemoProvider } from '../src/ai/demoProvider.js';
import { InMemoryJourneyRepository } from '../src/repositories/inMemoryJourneyRepository.js';
import { HOSPITAL_STORY, hospitalConfig } from './hospitalApi.js';
import { samplePdf } from './sampleDocuments.js';

const upload = type => ({ documentType: type, bytes: samplePdf(type), mimeType: 'application/pdf', filename: 'synthetic.pdf', size: samplePdf(type).length });
const service = (provider = createDemoProvider()) => createJourneyService({ provider, config: hospitalConfig, repository: new InMemoryJourneyRepository() });
test('Same-service correction preserves documents for review but revokes every old evidence point until re-upload', async () => {
  const s = service(); const other = await s.create({ message: '我要改地址' }); let j = await s.create({ message: HOSPITAL_STORY });
  for (const type of ['diagnosis_certificate', 'bank_passbook']) j = (await s.addDocument(j.id, upload(type))).journey;
  j = await s.review(j.id); assert.equal(j.readiness, 100);
  const corrected = await s.correctIntent(j.id, '更正：我在台中榮總住院五天，要申請住院理賠');
  j = corrected.journey; assert.equal(j.readiness, 35); assert.equal(j.confirmed, false); assert.equal(j.documents.length, 2);
  assert.ok(j.documents.every(document => document.requiresRevalidation && document.status === 'needs_review' && !document.matchedRequirements.length));
  await assert.rejects(async () => await s.review(j.id), { code: 'REVIEW_NOT_READY' }); assert.deepEqual((await s.get(other.id)), other);
  j = (await s.addDocument(j.id, upload('diagnosis_certificate'))).journey; assert.equal(j.readiness, 70);
  j = (await s.addDocument(j.id, upload('bank_passbook'))).journey; assert.equal(j.readiness, 90);
  assert.ok(j.documents.every(document => !document.requiresRevalidation)); assert.equal((await s.review(j.id)).readiness, 100);
});

test('Concurrent correction returns BUSY; a file deletion invalidates the late correction and GET stays current', async () => {
  const demo = createDemoProvider(); let release, pause = false;
  const s = service({ ...demo, understandIntent: async (...args) => { if (pause) await new Promise(resolve => { release = resolve; }); return demo.understandIntent(...args); } });
  let j = await s.create({ message: HOSPITAL_STORY }); j = (await s.addDocument(j.id, upload('diagnosis_certificate'))).journey;
  pause = true; const pending = s.correctIntent(j.id, '不是住院，是門診');
  await assert.rejects(s.correctIntent(j.id, '不是住院，是門診'), { code: 'JOURNEY_BUSY' });
  const removed = await s.removeDocument(j.id, j.documents[0].id); release();
  await assert.rejects(pending, { code: 'JOURNEY_STALE' });
  assert.deepEqual((await s.get(j.id)), removed); assert.equal((await s.get(j.id)).readiness, 35);
});
