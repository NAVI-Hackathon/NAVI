import test from 'node:test';
import assert from 'node:assert/strict';
import { hospitalClaimContext } from '../../../../shared/hospitalization.js';
import { UNCONFIRMED, channelStatus } from './channels.js';

test('server channels: an entry point is never shown as eligibility; this release only says 資格待確認', () => {
  const context = hospitalClaimContext({ hospitalName: '臺中榮民總醫院' });
  for (const channel of context.channels) {
    const shown = channelStatus(channel, context.hospital);
    assert.equal(shown.eligibility, 'requires_confirmation', channel.id);
    assert.equal(shown.tag, '資格待確認');
    assert.equal(shown.text, UNCONFIRMED);
    assert.equal(shown.entry, 'navigable');
    assert.ok(shown.toConfirm.length > 0, 'the conditions still to confirm are listed');
  }
});

test('missing eligibility (older server, /demo) is read as to be confirmed, never as eligible', () => {
  const legacy = { id: 'union_chain', name: '理賠聯盟鏈', available: true, notes: [], destination: {} };
  assert.equal(channelStatus(legacy).eligibility, 'requires_confirmation');
  assert.equal(channelStatus(legacy).text, UNCONFIRMED);
});

test('a hospital missing from the partner snapshot is a hint to check, not 已知條件不符合', () => {
  const context = hospitalClaimContext({ hospitalName: '不存在的示範醫院' });
  const upload = context.channels.find(c => c.id === 'hospital_upload');
  const shown = channelStatus(upload, context.hospital ?? { partner: false });
  assert.notEqual(shown.eligibility, 'ineligible');
  assert.match(shown.partnerHint ?? '', /未比對到/);
});

test('explicit statuses keep their limits: eligible names the channel only; navigation can be unavailable', () => {
  const eligible = channelStatus({ id: 'mail', eligibility: { status: 'eligible', unconfirmedRequirements: [] }, navigationAvailable: false });
  assert.match(eligible.text, /不代表保障適用或理賠核准/);
  assert.equal(eligible.entry, 'unavailable');
  assert.equal(channelStatus({ id: 'mail', eligibility: { status: 'ineligible', unconfirmedRequirements: [] } }).tag, '已知條件不符合');
});
