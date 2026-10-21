import { AnimatePresence, motion } from 'motion/react';
import Icon from '../Icon.jsx';
import { CheckDraw } from '../../motion/primitives.jsx';
import { transition } from '../../motion/tokens.js';
import { buildPreflight } from '../../domain/preflight.js';

const groups = [
  { key: 'review', title: '需要人工確認', tone: 'review', icon: 'alert' },
  { key: 'missing', title: '需要補件', tone: 'missing', icon: null },
  { key: 'obtained', title: '已取得', tone: 'done', icon: 'check' },
];

function ItemAction({ action, busy, onAction }) {
  if (!action) return null;
  const label = action.type === 'review' ? '確認資料' : action.type === 'handoff' ? '請專員確認' : action.label;
  const icon = action.type === 'review' ? 'check' : action.type === 'handoff' ? 'headset' : 'upload';
  return (
    <button type="button" className="preflight-action" disabled={busy && action.type === 'upload'} onClick={() => onAction(action)}>
      <Icon name={icon} size={13} />{label}
    </button>
  );
}

function Mark({ tone }) {
  if (tone === 'done') return <span className="preflight-mark"><CheckDraw size={11} strokeWidth={2.6} /></span>;
  if (tone === 'review') return <span className="preflight-mark"><Icon name="alert" size={12} strokeWidth={2} /></span>;
  return <span className="preflight-mark" aria-hidden="true" />;
}

/**
 * Claim Preflight: what NAVI already has, what is still missing, and what needs a person —
 * each with the reason and the one thing to do next. Items glide between groups as the server
 * updates the journey (shared layoutId per requirement).
 */
export default function PreflightBoard({ journey, explanation, busy, onAction }) {
  const board = buildPreflight(journey, { explanation });
  const total = board.obtained.length + board.missing.length + board.review.length;

  return (
    <section className="preflight" aria-labelledby="preflight-title">
      <div className="preflight-head">
        <h3 id="preflight-title">理賠文件健檢</h3>
        <p className="preflight-counts">
          <span className="is-done">{board.obtained.length} 已取得</span>
          <span className="is-missing">{board.missing.length} 待補</span>
          <span className={`is-review ${board.review.length ? 'has-items' : ''}`}>{board.review.length} 待確認</span>
        </p>
      </div>
      <div className="preflight-bar" aria-hidden="true">
        {['obtained', 'missing', 'review'].map(key => (
          <motion.span key={key} className={`seg seg-${key}`} initial={false}
            animate={{ flexGrow: board[key].length }} transition={transition.slow} style={{ flexBasis: 0 }} />
        ))}
      </div>

      {groups.map(group => board[group.key].length > 0 && (
        <div key={group.key} className={`preflight-group tone-${group.tone}`}>
          <h4>{group.title}<span>{board[group.key].length}</span></h4>
          <ul>
            <AnimatePresence initial={false}>
              {board[group.key].map(item => (
                <motion.li key={item.id} layoutId={`preflight-${item.id}`} layout="position" className="preflight-item"
                  initial={{ opacity: 0 }} animate={{ opacity: 1, transition: transition.enter }} exit={{ opacity: 0, transition: transition.exit }}
                  transition={transition.layout}>
                  <Mark tone={group.tone} />
                  <div className="preflight-body">
                    <p className="preflight-title">{item.title}{item.earned > 0 && <span className="preflight-earned">+{item.earned}%</span>}</p>
                    {item.detail && <p className="preflight-detail">{item.detail}</p>}
                    {item.reasons?.map(reason => <p key={reason} className="preflight-reason">{reason}</p>)}
                    <ItemAction action={item.action} busy={busy} onAction={onAction} />
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      ))}

      {total > 0 && board.missing.length === 0 && board.review.length === 0 && (
        <p className="preflight-clear"><CheckDraw size={13} strokeWidth={2.4} />所有必要資料都已備齊</p>
      )}

      {board.optional.length > 0 && (
        <details className="preflight-optional">
          <summary>依病況可能需要 {board.optional.length} 項<Icon name="chevron" size={12} /></summary>
          <ul>{board.optional.map(item => <li key={item.id}>{item.title}</li>)}</ul>
          <p>是否需要提供，由保險公司依實際情況通知；NAVI 不做判斷。</p>
        </details>
      )}
    </section>
  );
}
