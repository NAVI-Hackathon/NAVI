// What the workspace says about the hospital, from the journey as it is now (NAVI-006). Every place that
// names the hospital or 醫起通 reads it here, so the header, the assistant, the steps and the checklist
// never disagree after a document is added, replaced or removed. Presentation only: the hospital comes
// from the service's claimContext, and a name on the partner list is never read as eligibility.
import { channelStatus } from './channels.js';

/**
 * @returns {{ name: string|null, source: 'certificate'|null, listed: boolean|null,
 *   eligibility: string|null, toConfirm: string[] }}
 *   listed: on the 醫起通 partner snapshot list (null while the hospital is unknown).
 *   toConfirm: the 醫起通 conditions still to confirm — the server's own list, else the official notes.
 */
export function hospitalFacts(journey) {
  const hospital = journey.claimContext?.hospital ?? null;
  if (!hospital) return { name: null, source: null, listed: null, eligibility: null, toConfirm: [] };
  const certificate = journey.documents?.find(doc => doc.documentType === 'diagnosis_certificate' && doc.status === 'verified');
  // claimContext has no provenance field yet: only a verified certificate naming this hospital is said to be
  // its source; anything else is shown without one (never assumed to be the user's own words).
  const source = certificate?.fields?.hospitalName === hospital.mentioned ? 'certificate' : null;
  const channel = journey.claimContext.channels?.find(item => item.id === 'hospital_upload');
  const shown = channel ? channelStatus(channel, hospital) : null;
  const toConfirm = !hospital.partner || shown?.eligibility === 'eligible' ? []
    : shown?.toConfirm.length ? shown.toConfirm : (channel?.notes ?? []);
  return { name: hospital.matchedName ?? hospital.mentioned, source, listed: hospital.partner, eligibility: shown?.eligibility ?? null, toConfirm };
}

/** 「臺中榮民總醫院（診斷書記載）」, the name alone when no document names it, or 待確認. */
export function hospitalLabel(facts) {
  if (!facts.name) return '待確認';
  return facts.source === 'certificate' ? `${facts.name}（診斷書記載）` : facts.name;
}

/** 醫起通 in a few words: on the list is not eligibility. */
export function partnerLabel(facts) {
  if (facts.listed === null) return '待確認醫院';
  if (!facts.listed) return '未對應合作院所';
  return facts.eligibility === 'eligible' ? '合作名單內・符合已知條件' : '合作名單內・資格待確認';
}

/** The 醫院與管道 step: done only once the hospital is known — named on the partner list, or by a certificate. */
export function hospitalStep(journey) {
  const facts = hospitalFacts(journey);
  if (!facts.name) return { done: false, text: '還不知道住院的醫院，上傳診斷書或住院證明後會確認。' };
  const from = facts.source === 'certificate' ? '依診斷書記載，' : '';
  // J-05: a name only the user gave that matches no partner may not be a real hospital, so it stays to confirm.
  if (!facts.listed && facts.source !== 'certificate') {
    return { done: false, text: `你提到的醫院是「${facts.name}」，目前無法在快照中確認這間院所。上傳診斷書或住院證明後會再確認；也可以先查看理賠聯盟鏈或郵寄申請。` };
  }
  if (!facts.listed) {
    return { done: true, text: `${from}住院醫院是「${facts.name}」，快照中未比對到醫起通合作院所，可改用理賠聯盟鏈或郵寄申請；若是合作院所，請提供醫院全名。` };
  }
  const channel = facts.eligibility === 'eligible' ? '已符合此管道已知的條件，不代表理賠核准。'
    : `能否使用此管道仍需確認${facts.toConfirm.length ? `，請留意：${facts.toConfirm.join('；')}` : ''}。`;
  return { done: true, text: `${from}住院醫院是「${facts.name}」，在醫起通合作院所名單上；${channel}` };
}
