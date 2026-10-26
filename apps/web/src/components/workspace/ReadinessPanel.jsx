import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Icon from '../Icon.jsx';
import NextActionCard from './NextActionCard.jsx';
import PreflightBoard from './PreflightBoard.jsx';
import { CheckDraw, useCountUp } from '../../motion/primitives.jsx';
import { duration, ease, transition } from '../../motion/tokens.js';
import { documentSpecs } from '../../mocks/hospitalClaim.js';

export function ReadinessRing({ value, size = 200, compact = false }) {
  const shown = useCountUp(value);
  const reduced = useReducedMotion();
  const complete = value >= 100;
  return (
    <div className={`ring ${compact ? 'ring-compact' : ''} ${complete ? 'is-complete' : ''}`} style={{ width: size, height: size }}
      role="progressbar" aria-label="準備完成度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="ring-track" cx="60" cy="60" r="52" pathLength="100" />
        <motion.circle
          className="ring-fill" cx="60" cy="60" r="52" pathLength="100" strokeDasharray="100"
          initial={false} animate={{ strokeDashoffset: 100 - value }}
          transition={reduced ? { duration: 0 } : { duration: duration.count, ease: ease.standard }}
        />
      </svg>
      <div className="ring-value" aria-hidden="true">
        <strong>{Math.round(shown)}</strong><span>%</span>
      </div>
      <AnimatePresence>
        {complete && (
          <motion.span className="ring-badge" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1, transition: { ...transition.enter, delay: duration.count } }} exit={{ opacity: 0 }}>
            <CheckDraw size={14} strokeWidth={2.6} delay={duration.count + 0.08} />
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

/** "+35%" that appears when readiness goes up, then fades. */
function useReadinessDelta(value) {
  const previous = useRef(value);
  const [delta, setDelta] = useState(null);
  useEffect(() => {
    const change = value - previous.current;
    previous.current = value;
    if (change <= 0) return undefined;
    const show = setTimeout(() => setDelta({ change, key: Date.now() }), 0);
    const hide = setTimeout(() => setDelta(null), 1800);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, [value]);
  return delta;
}

function RequirementList({ requirements }) {
  const done = requirements.filter(r => r.status === 'verified');
  const pending = requirements.filter(r => r.status !== 'verified' && r.required);
  const optional = requirements.filter(r => r.status !== 'verified' && !r.required);
  return (
    <div className="requirements">
      {done.length > 0 && (
        <div className="requirement-group">
          <h3>已完成 <span>{done.length}</span></h3>
          <ul>
            {done.map(r => (
              <motion.li layout="position" key={r.id} className="requirement is-done" transition={transition.normal}>
                <span className="requirement-mark"><CheckDraw size={12} strokeWidth={2.4} /></span>{r.name}
              </motion.li>
            ))}
          </ul>
        </div>
      )}
      {pending.length > 0 && (
        <div className="requirement-group">
          <h3>待補 <span>{pending.length}</span></h3>
          <ul>
            {pending.map(r => (
              <motion.li layout="position" key={r.id} className="requirement" transition={transition.normal}>
                <span className="requirement-mark" aria-hidden="true" />{r.name}
              </motion.li>
            ))}
          </ul>
        </div>
      )}
      {optional.length > 0 && (
        <div className="requirement-group is-optional">
          <h3>依情況準備</h3>
          <ul>
            {optional.map(r => (
              <li key={r.id} className="requirement"><span className="requirement-mark" aria-hidden="true" />{r.name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ReadinessPanel({ snapshot, busy, onAction, onSample, sampleByAi, onHandoff, onNavigate, preflight, showNextAction = true }) {
  const { journey } = snapshot;
  const isHospital = snapshot.context.kind === 'hospital' && journey.currentStage !== 'HUMAN_REVIEW';
  const delta = useReadinessDelta(journey.readiness);
  const complete = journey.currentStage === 'READY_TO_PROCEED';
  const missing = journey.requirements.filter(r => r.required && r.status !== 'verified').length;

  return (
    <aside className="panel readiness-panel" aria-labelledby="readiness-title">
      <header className="panel-header">
        <h2 id="readiness-title">{isHospital ? '準備完成度' : '需要準備的資料'}</h2>
      </header>

      {isHospital ? (
        <div className="readiness-summary">
          <div className="ring-wrap">
            <ReadinessRing value={journey.readiness} />
            <AnimatePresence>
              {delta && (
                <motion.span key={delta.key} className="readiness-delta"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: transition.enter }}
                  exit={{ opacity: 0, y: -8, transition: { duration: duration.slow, ease: ease.exit } }}>
                  +{delta.change}%
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p key={complete ? 'done' : missing} className={`readiness-caption ${complete ? 'is-complete' : ''}`}
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0, transition: transition.enter }} exit={{ opacity: 0, transition: transition.exit }}>
              {complete ? '資料初步準備完成・尚未送件' : missing ? `還有 ${missing} 項資料待補齊` : '必要文件已備齊，請確認資料'}
            </motion.p>
          </AnimatePresence>
        </div>
      ) : (
        <>
          <p className="readiness-basic">{journey.currentStage === 'HUMAN_REVIEW' ? '這個情況需要專員確認，NAVI 已先整理好你的描述。' : '這項服務目前提供辦理導引。先備妥以下資料，再前往服務入口。'}</p>
          {/* Kept after a correction: shown, but only as something to confirm — never as a verified document. */}
          {journey.documents.length > 0 && (
            <p className="readiness-basic"><Icon name="info" size={13} />先前上傳的文件已保留，需要重新確認，目前不計分：{journey.documents.map(d => documentSpecs[d.documentType]?.title ?? d.filename).join('、')}</p>
          )}
        </>
      )}

      {showNextAction && <NextActionCard action={journey.nextAction} complete={complete} busy={busy} onAction={onAction} onSample={onSample} sampleByAi={sampleByAi} onNavigate={onNavigate} />}

      {isHospital && preflight
        ? <PreflightBoard journey={journey} explanation={preflight.explanation} busy={busy} onAction={preflight.onAction} />
        : journey.requirements.length > 0 && <RequirementList requirements={journey.requirements} />}

      <p className="readiness-note"><Icon name="shield" size={14} />準備完成度是 NAVI 對資料的初步檢核，不代表理賠核准、保障判斷或已送件。</p>
      {journey.nextAction.type !== 'CONTACT_SPECIALIST' && (
        <button type="button" className="link-button specialist-link" onClick={onHandoff}>
          <Icon name="headset" size={16} />需要協助？轉由專員接續<Icon name="chevron" size={14} />
        </button>
      )}
    </aside>
  );
}
