import { officialSourcesOf, openConditions, requirementGroups, stageLabel, workspaceProfile } from './workspace.js';

// The user's own take-away of a journey: only the journey's state as the server returned it (service,
// stage, which items are done or missing, what is open, the next step, official sources). Field values
// read from documents (names, dates, accounts) and the user's own description are never included.

const statusWord = { verified: '已完成', uploaded: '已上傳待確認', needs_review: '待人工確認', missing: '尚缺' };

/** @returns {string} plain text, one line per item */
export function journeySummaryText(snapshot, { now = new Date() } = {}) {
  const { journey } = snapshot;
  const full = workspaceProfile(snapshot) === 'full';
  const { done, pending, optional } = requirementGroups(journey);
  const line = r => `・${r.name}：${statusWord[r.status] ?? r.status}`;
  const conditions = openConditions(journey);
  const next = journey.nextAction?.type && journey.nextAction.type !== 'NONE' ? journey.nextAction : null;
  return [
    `NAVI 辦理摘要（整理時間 ${now.toLocaleString('zh-TW', { hour12: false })}）`,
    `服務：${journey.title}`,
    `目前狀態：${stageLabel(journey)}${full && Number.isFinite(journey.readiness) ? `（NAVI 資料準備度 ${journey.readiness}%，非核賠結果）` : ''}`,
    ...(done.length || pending.length ? ['', '必要項目：', ...[...done, ...pending].map(line)] : []),
    ...(optional.length ? ['', '依情況需要：', ...optional.map(line)] : []),
    ...(conditions.length ? ['', '待確認：', ...conditions.map(c => `・${c.text}`)] : []),
    ...(next ? ['', `下一步：${next.title}${next.description ? `——${next.description}` : ''}`] : []),
    ...officialSourcesOf(journey).map(({ fallback }, i) => `${i ? '' : '\n'}官方來源：${fallback.title}（擷取 ${fallback.retrievedAt}）${fallback.url}`),
    '',
    '本摘要由 NAVI 依官網公開資料整理，只供你自己準備時參考；不是申請、不代表已送件，也不判斷能否理賠。實際規定以法國巴黎人壽官方公告為準。',
  ].join('\n');
}

/** A file name that sorts by date and says what it is. */
export const summaryFileName = (now = new Date()) => `NAVI-辦理摘要-${now.toISOString().slice(0, 10)}.txt`;
