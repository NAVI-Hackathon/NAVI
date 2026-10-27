// How a claim channel is presented (docs/judge2-contract.md): having an entry point, being navigable and
// meeting the channel's conditions are separate facts. A missing eligibility (older server, /demo) is read
// conservatively as "to be confirmed" — never as eligible. Presentation only: the server decides.

export const UNCONFIRMED = '此管道可供查詢，實際適用資格仍需確認。';

const ELIGIBILITY = {
  requires_confirmation: { tag: '資格待確認', text: UNCONFIRMED, tone: 'pending' },
  // Only the channel's own conditions; never coverage or a payout.
  eligible: { tag: '符合已知條件', text: '已符合此管道已知的申請條件；不代表保障適用或理賠核准。', tone: 'ok' },
  ineligible: { tag: '已知條件不符合', text: '依已知條件，此管道目前不適用，請改用其他管道或洽客服。', tone: 'no' },
};

/**
 * @returns {{ entry: 'navigable'|'unavailable', eligibility: 'requires_confirmation'|'eligible'|'ineligible',
 *   tag: string, text: string, tone: string, partnerHint: string|null, toConfirm: string[] }}
 */
export function channelStatus(channel, hospital = null) {
  const status = ELIGIBILITY[channel.eligibility?.status] ? channel.eligibility.status : 'requires_confirmation';
  const shown = ELIGIBILITY[status];
  // 醫起通 matches the hospital against a snapshot list: a miss is a hint to check, not an official「不合作」.
  const partnerHint = channel.id === 'hospital_upload' && hospital && !hospital.partner ? '快照中未比對到你的院所，請先確認是否為合作院所。' : null;
  return {
    entry: channel.navigationAvailable === false ? 'unavailable' : 'navigable',
    eligibility: status,
    ...shown,
    partnerHint,
    toConfirm: status === 'requires_confirmation' ? (channel.eligibility?.unconfirmedRequirements ?? []) : [],
  };
}
