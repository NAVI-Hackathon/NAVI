import { useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Icon from '../Icon.jsx';
import { verifiedEvidence } from '../../../../../shared/knowledge/evidence.js';
import { transition } from '../../motion/tokens.js';

/** "今天" / "3 天前"; review_recommended (over 90 days) is a maintenance hint, not a rule change. */
function freshness(snapshot) {
  if (snapshot.status === 'review_recommended') return { text: `${snapshot.ageDays} 天前・建議再確認`, stale: true };
  return { text: snapshot.ageDays === 0 ? '今天' : `${snapshot.ageDays} 天前`, stale: false };
}

/**
 * Trusted source for one knowledge entry: title, official link, snapshot date and the literal snapshot
 * lines behind the answer (shared/knowledge/evidence.js — the same check as GET /api/knowledge/evidence).
 * These are 資料快照摘錄 verified against the local snapshot, not a live check of the official site.
 */
export default function SourceEvidence({ sourceId, preferredLines = [], onNavigate, fallback }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const evidence = sourceId ? verifiedEvidence(sourceId, { preferredLines }) : null;

  if (!evidence) {
    // No verifiable snapshot lines: keep the plain source line rather than invent an excerpt.
    return fallback ? (
      <p className="qa-source"><Icon name="book" size={12} />依據：
        <a href={fallback.url} target="_blank" rel="noopener noreferrer">法國巴黎人壽官網・{fallback.title}</a>（擷取 {fallback.retrievedAt}）
      </p>
    ) : null;
  }
  const { source, excerpts, snapshot } = evidence;
  const fresh = freshness(snapshot);
  return (
    <div className={`source-evidence ${open ? 'is-open' : ''}`}>
      <button type="button" className="source-toggle" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(value => !value)}>
        <Icon name="book" size={13} />
        <span className="source-title">依據：官網・{source.title}</span>
        <span className={`source-date ${fresh.stale ? 'is-stale' : ''}`}>{source.retrievedAt}・{fresh.text}</span>
        <Icon name="chevron" size={12} className="source-chevron" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div id={panel} className="source-panel"
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto', transition: transition.normal }} exit={{ opacity: 0, height: 0, transition: transition.exit }}>
            <p className="source-label">資料快照摘錄</p>
            <blockquote><ul>{excerpts.map(line => <li key={line}>{line}</li>)}</ul></blockquote>
            <p className="source-scope">已與本地官網資料快照逐字核對，非即時查核官網；內容以官網公告為準。</p>
            <div className="source-actions">
              <a href={source.url} target="_blank" rel="noopener noreferrer" className="link-button"><Icon name="external" size={13} />開啟官網原頁</a>
              {onNavigate && (
                <button type="button" className="link-button navigate-link" onClick={() => onNavigate(source.navigationDestination)}>
                  <Icon name="route" size={13} />帶我去這段的位置
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
