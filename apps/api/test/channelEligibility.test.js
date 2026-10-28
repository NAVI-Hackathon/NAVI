import test from 'node:test';
import assert from 'node:assert/strict';
import { hospitalClaimContext } from '../../../shared/hospitalization.js';
import { ClaimChannelSchema, ChannelEligibilitySchema, DocumentSchema, ServiceJourneySchema } from '../../../shared/journey.js';
import { getKnowledgeEntry, verifyNavigationDestination } from '../../../shared/knowledge/index.js';
import { buildNavigationPlan, verifyNavigationPlan } from '../../../shared/knowledge/navigationPlan.js';
import { startHospitalApi } from './hospitalApi.js';
import { loadConfig } from '../src/config/env.js';

for (const hospitalName of [null, '台中榮總', '台中榮總不存在分院', '榮總', '合成測試院所']) test(`Channel existence and matching never establish eligibility: ${hospitalName}`, () => {
  const context = hospitalClaimContext({ hospitalName });
  for (const channel of context.channels) {
    ClaimChannelSchema.parse(channel);
    assert.equal(channel.navigationAvailable, true);
    assert.equal(channel.eligibility.status, 'requires_confirmation');
    assert.equal(channel.eligibility.coverageAssessed, false);
    assert.equal(channel.eligibility.scope, 'channel_conditions_only');
    const record = getKnowledgeEntry(channel.eligibility.sourceIds[0]); assert.ok(record);
    assert.ok(channel.eligibility.unconfirmedRequirements.every(text => record.content.includes(text)));
    assert.equal(channel.notes[0], channel.eligibility.reason);
    const plan = buildNavigationPlan(record.id); assert.ok(verifyNavigationPlan(plan));
    // The plan has a canonical display target; labels/kinds may differ from a Journey's CTA.
    assert.ok(plan.steps.some(step => step.destination.path === channel.destination.path && step.destination.anchor === channel.destination.anchor));
  }
  assert.equal(context.channels[0].available, hospitalName === '台中榮總'); // Legacy matching semantics preserved.
  assert.equal(context.channels[1].available, true); assert.equal(context.channels[2].available, true);
});

test('Channel contract accepts legacy payloads, rejects contradictory eligible/missing-facts and forged navigation', () => {
  const channel = hospitalClaimContext({}).channels[0];
  const { eligibility, navigationAvailable, ...legacy } = channel; ClaimChannelSchema.parse(legacy);
  assert.throws(() => ChannelEligibilitySchema.parse({ ...eligibility, status: 'eligible' }));
  assert.throws(() => ClaimChannelSchema.parse({ ...channel, destination: { ...channel.destination, path: '//evil.invalid' } }));
  assert.equal(verifyNavigationDestination(channel.destination, 'service:claim_union_chain'), false);
});

test('100% means preparation only; complete synthetic evidence cannot establish channel eligibility or authenticity', async () => {
  const api = await startHospitalApi();
  try {
    let j = await api.create(); assert.equal(j.readiness, 35);
    const first = await (await api.upload(j.id, 'diagnosis_certificate')).json(); j = first.journey;
    assert.equal(j.readiness, 70); assert.equal(first.document.status, 'verified');
    assert.deepEqual(first.document.verification, { scope: 'prototype_field_consistency', authenticity: 'not_assessed', eligibility: 'not_assessed' });
    const second = await (await api.upload(j.id, 'bank_passbook')).json(); j = second.journey; assert.equal(j.readiness, 90);
    j = await (await api.request(`/journeys/${j.id}/review`, { confirmed: true })).json(); ServiceJourneySchema.parse(j); assert.equal(j.readiness, 100);
    assert.ok(j.claimContext.channels.every(c => c.eligibility.status === 'requires_confirmation'));
    assert.match(j.nextAction.description, /條件仍需確認/); assert.match(j.disclaimer, /不代表.*理賠核准/);
    const explanation = await (await api.request(`/journeys/${j.id}/explanation`)).json();
    assert.ok(explanation.criteria.filter(r => r.status === 'verified').every(r => r.reason.includes('不代表文件真偽')));
    const legacy = { ...first.document }; delete legacy.verification; DocumentSchema.parse(legacy);
    const removed = await (await api.request(`/journeys/${j.id}/documents/${second.document.id}`, undefined, 'DELETE')).json();
    assert.equal(removed.readiness, 70); assert.equal(removed.confirmed, false);
    assert.ok(removed.claimContext.channels.every(c => c.eligibility.status === 'requires_confirmation'));
  } finally { await api.close(); }
});

test('Default caps are 12, production override 20 is explicit; no guard or retry change is necessary', () => {
  const defaults = loadConfig({}); assert.equal(defaults.dailyLimit, 12); assert.equal(defaults.liveRequestLimit, 12);
  const configured = loadConfig({ NODE_ENV: 'production', AI_MODE: 'live', GEMINI_API_KEY: 'synthetic', GEMINI_FREE_TIER_CONFIRMED: 'true', AI_PUBLIC_SYNTHETIC: 'true', AI_USAGE_FILE: '/private/synthetic-usage.json', ALLOW_PAID_AI: 'false', AI_DAILY_REQUEST_LIMIT: '20', LIVE_AI_REQUEST_LIMIT: '20' });
  assert.equal(configured.dailyLimit, 20); assert.equal(configured.liveRequestLimit, 20); assert.equal(configured.aiMaxAttempts, 1); assert.equal(configured.allowPaidAI, false);
});

test('Gemini cannot assign document authenticity or channel eligibility through extra output fields', async () => {
  const { normalizeGeminiDocument } = await import('../src/ai/schemas.js');
  const raw = { documentType: 'unknown', confidence: .99, fields: { passengerName: null, flightNumber: null, origin: null, destination: null, departureDate: null, actualDepartureDate: null, scheduledDeparture: null, actualDeparture: null } };
  for (const extra of [{ verification: { authenticity: 'verified' } }, { eligibility: 'eligible' }, { readiness: 100 }]) assert.throws(() => normalizeGeminiDocument({ ...raw, ...extra }));
});
