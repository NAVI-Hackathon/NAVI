import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Icon from '../Icon.jsx';
import { transition } from '../../motion/tokens.js';

/**
 * Guided Action: one step of a navigation plan at a time. The user moves with 上一步／下一步;
 * each step takes the insurer site to that place (embedded: the host page moves and spotlights it;
 * standalone: 在官網開啟 opens it in a new tab). Only page navigation — no login, forms or submission.
 */
export default function GuideCard({ guide, embedded, onStep, onOpen, onEnd }) {
  const { plan, index } = guide;
  const step = plan.steps[index];
  const last = index === plan.steps.length - 1;
  // The first snapshot line is usually the title itself; show what the page says beyond it.
  const lines = step.evidence.filter(line => line !== step.source.title);
  const excerpts = lines.length ? lines : step.evidence.slice(0, 1);
  const direction = useRef(1);
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [index]);

  function go(next) {
    direction.current = next > index ? 1 : -1;
    onStep(next);
  }

  return (
    <motion.section
      className="guide-card" role="region" aria-label="NAVI 逐步導覽"
      initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0, transition: transition.slow }} exit={{ opacity: 0, y: 16, transition: transition.exit }}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onEnd(); } }}
    >
      <header className="guide-head">
        <span className="guide-eyebrow"><span className="pulse-dot" aria-hidden="true" />NAVI 帶你走</span>
        <span className="guide-count">第 {index + 1} / {plan.steps.length} 步</span>
        <button type="button" className="icon-button guide-close" aria-label="結束導覽" onClick={onEnd}><Icon name="close" size={16} /></button>
      </header>
      <ol className="guide-progress" aria-hidden="true">
        {plan.steps.map((s, i) => (
          <li key={s.id} className={i < index ? 'is-done' : i === index ? 'is-current' : ''}>
            {i === index && <motion.span className="guide-progress-fill" layoutId="guide-progress" transition={transition.normal} />}
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait" initial={false} custom={direction.current}>
        <motion.div key={step.id} className="guide-body" aria-live="polite"
          initial={{ opacity: 0, x: 14 * direction.current }} animate={{ opacity: 1, x: 0, transition: transition.enter }}
          exit={{ opacity: 0, x: -10 * direction.current, transition: transition.exit }}>
          <p className="guide-instruction">{step.instruction}</p>
          <h2 ref={heading} tabIndex={-1} className="guide-title">{step.destination.label}</h2>
          <p className="guide-where">
            {embedded ? <><Icon name="route" size={13} />官網已帶到這裡並標示出來</> : <><Icon name="external" size={13} />在模擬官網的位置</>}
          </p>
          <blockquote className="guide-evidence">
            <ul>{excerpts.map(line => <li key={line}>{line}</li>)}</ul>
            <footer>
              資料快照摘錄・
              <a href={step.source.url} target="_blank" rel="noopener noreferrer">{step.source.title}</a>
              （擷取 {step.source.retrievedAt}）
            </footer>
          </blockquote>
        </motion.div>
      </AnimatePresence>

      <div className="guide-actions">
        <button type="button" className="button button-ghost button-small" disabled={index === 0} onClick={() => go(index - 1)}>
          <Icon name="back" size={15} />上一步
        </button>
        {!embedded && (
          <button type="button" className="button button-secondary button-small" onClick={() => onOpen(step)}>
            在官網開啟<Icon name="external" size={14} />
          </button>
        )}
        <button type="button" className="button button-primary button-small guide-next" onClick={() => (last ? onEnd(true) : go(index + 1))}>
          {last ? '完成導覽' : '下一步'}<Icon name={last ? 'check' : 'arrow'} size={15} />
        </button>
      </div>
      <p className="guide-disclaimer">{plan.disclaimer}</p>
    </motion.section>
  );
}
