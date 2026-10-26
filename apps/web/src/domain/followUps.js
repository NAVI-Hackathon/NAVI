// Chat follow-ups: the option buttons NAVI offers under a reply, and the follow-up question when a
// request is too broad. Presentation only — a chosen option is sent back through the same search /
// backend analysis (combined with what the user said before), which still decides the answer.
import { DEMO_STORY } from '../mocks/hospitalClaim.js';

/** Opening choices. `send` is what NAVI analyses; `label` is what appears in the user's bubble. */
export const STARTERS = [
  { label: '我住院了，想申請理賠', send: DEMO_STORY, icon: 'medical' },
  { label: '我搬家了，想改地址', send: '我最近搬家了，保單上的地址要怎麼改？', icon: 'document' },
  { label: '下載契約變更申請書', send: '我要下載保險契約內容變更申請書', icon: 'document' },
  { label: '想用保單借錢', send: '我想用保單借錢週轉，要準備什麼？', icon: 'bank' },
];

// When the backend needs more detail, these are the services NAVI can actually help with.
const SERVICE_CHOICES = [
  { label: '住院醫療理賠', send: '我想申請住院醫療理賠' },
  { label: '門診理賠', send: '我只有門診，想申請理賠' },
  { label: '變更地址', send: '我想變更保單地址' },
  { label: '保單借款', send: '我想辦理保單借款' },
];

const HUMAN = { label: '找真人客服', action: 'hotline' };

const combine = (context, send) => (context ? `${context}。${send}` : send);

/**
 * Options after official answers. A broad claim question that matched several claim types becomes a
 * follow-up question instead of a pile of answers.
 * @returns {{ question?: string, options: {label: string, send?: string, action?: string}[], showAnswers: boolean }}
 */
export function followUpForAnswers(result, askedText) {
  const claimTypes = result.results.filter(entry => entry.type === 'claim_documents');
  if (claimTypes.length >= 2) {
    // 住院醫療 is the service NAVI supports end to end; keep it first even if search ranked it lower.
    const kinds = ['住院醫療', ...claimTypes.map(entry => entry.title.replace(/理賠應備文件$/, ''))];
    const unique = [...new Set(kinds)].slice(0, 3);
    return {
      question: '理賠的應備文件依類型不同。你要申請哪一種？',
      options: unique.map(kind => ({ label: kind, send: combine(askedText, `我要申請${kind}理賠`) })).concat(HUMAN),
      showAnswers: false,
    };
  }
  const more = [...result.results.slice(1), ...result.related]
    .filter((entry, index, list) => list.findIndex(other => other.id === entry.id) === index)
    .slice(0, 2)
    .map(entry => ({ label: entry.title, send: entry.title }));
  return { options: [...more, HUMAN], showAnswers: true };
}

/** The backend could not tell what the user needs: ask which service, keeping their words as context. */
export function followUpForClarification(askedText) {
  return {
    question: '想先確認一下，你想辦理哪一件事？',
    options: [...SERVICE_CHOICES.map(choice => ({ label: choice.label, send: combine(askedText, choice.send) })), HUMAN],
  };
}

/** Questions NAVI does not answer (advice, claim decisions) or services outside the prototype. */
export function followUpForRefusal() {
  return { options: [...STARTERS.slice(0, 2).map(({ label, send }) => ({ label, send })), HUMAN] };
}
