import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Icon from '../Icon.jsx';
import { transition } from '../../motion/tokens.js';

/**
 * Where the step is, in words that match what the site reported. "已帶到" only after the host said it
 * found and marked the place; a missing or unconfirmed place says so and offers the other ways in.
 */
function Where({ embedded, single, arrival }) {
  if (embedded) {
    if (arrival === 'found') return <p className="guide-where"><Icon name="route" size={13} />官網已帶到這裡並標示出來</p>;
    if (arrival === 'going') return <p className="guide-where is-going"><span className="dots" aria-hidden="true"><i /><i /><i /></span>正在官網上尋找這個位置…</p>;
  }
  if (arrival === 'opened' || (!embedded && single)) return <p className="guide-where"><Icon name="external" size={13} />已在新分頁開啟模擬官網的這個位置</p>;
  if (!embedded && !arrival) return <p className="guide-where"><Icon name="external" size={13} />在模擬官網的位置</p>;
  return null;
}

const notFound = {
  missing: '官網這一頁找不到這個位置',
  silent: '官網沒有回報是否找到這個位置',
  unverified: '這個位置尚未通過驗證，NAVI 不會帶你過去',
};

/** The other ways in when the place is not there: the official page itself, the hotline, a specialist. */
function Fallback({ arrival, step, hotline, onHandoff }) {
  return (
    <div className="guide-fallback" role="alert">
      <p className="guide-fallback-title">{notFound[arrival]}</p>
      <p>可以改用以下方式繼續：</p>
      <ul>
        {step.source?.url && (
          <li><a href={step.source.url} target="_blank" rel="noopener noreferrer">開啟官網原頁：{step.source.title}<Icon name="external" size={12} /></a></li>
        )}
        {hotline && <li>撥打免付費服務專線 {hotline}</li>}
        {onHandoff && <li><button type="button" className="link-button" onClick={onHandoff}>轉由專員協助</button></li>}
      </ul>
    </div>
  );
}

/**
 * Guided Action: one step of a navigation plan at a time. The user moves with 上一步／下一步;
 * each step takes the insurer site to that place (embedded: the host page moves and spotlights it;
 * standalone: 在官網開啟 opens it in a new tab). A place reached in one move uses the same card with
 * one step. Only page navigation — no login, forms or submission.
 */
export default function GuideCard({ guide, embedded, arrival = null, hotline = null, onHandoff = null, onStep, onOpen, onEnd }) {
  const { plan, index, single = false, service = null, prerequisites = [] } = guide;
  const step = plan.steps[index];
  const last = index === plan.steps.length - 1;
  const lost = arrival in notFound;
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
      className="guide-card" role="region" aria-label={single ? "NAVI 前往官網" : "NAVI 逐步導覽"}
      initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0, transition: transition.slow }} exit={{ opacity: 0, y: 16, transition: transition.exit }}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onEnd(); } }}
    >
      <header className="guide-head">
        <span className="guide-eyebrow"><span className="pulse-dot" aria-hidden="true" />{single ? 'NAVI 帶你去' : 'NAVI 帶你走'}{service && <span className="guide-service">・{service}</span>}</span>
        {!single && <span className="guide-count">第 {index + 1} / {plan.steps.length} 步</span>}
        <button type="button" className="icon-button guide-close" aria-label="結束導覽" onClick={onEnd}><Icon name="close" size={16} /></button>
      </header>
      {!single && <ol className="guide-progress" aria-hidden="true">
        {plan.steps.map((s, i) => (
          <li key={s.id} className={i < index ? 'is-done' : i === index ? 'is-current' : ''}>
            {i === index && <motion.span className="guide-progress-fill" layoutId="guide-progress" transition={transition.normal} />}
          </li>
        ))}
      </ol>}

      <AnimatePresence mode="wait" initial={false} custom={direction.current}>
        <motion.div key={step.id} className="guide-body" aria-live="polite"
          initial={{ opacity: 0, x: 14 * direction.current }} animate={{ opacity: 1, x: 0, transition: transition.enter }}
          exit={{ opacity: 0, x: -10 * direction.current, transition: transition.exit }}>
          <p className="guide-instruction">{step.instruction}</p>
          <h2 ref={heading} tabIndex={-1} className="guide-title">{step.destination.label}</h2>
          <Where embedded={embedded} single={single} arrival={arrival} />
          {lost && <Fallback arrival={arrival} step={step} hotline={hotline} onHandoff={onHandoff} />}
          {index === 0 && prerequisites.length > 0 && (
            <div className="guide-prereq">
              <p>前往前，這件事還有：</p>
              <ul>{prerequisites.map(item => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          <blockquote className="guide-evidence">
            {excerpts.length > 0 && <ul>{excerpts.map(line => <li key={line}>{line}</li>)}</ul>}
            <footer>
              {excerpts.length > 0 ? '資料快照摘錄・' : '官網來源・'}
              <a href={step.source.url} target="_blank" rel="noopener noreferrer">{step.source.title}</a>
              （擷取 {step.source.retrievedAt}）
            </footer>
          </blockquote>
        </motion.div>
      </AnimatePresence>

      <div className="guide-actions">
        {!single && (
          <button type="button" className="button button-ghost button-small" disabled={index === 0} onClick={() => go(index - 1)}>
            <Icon name="back" size={15} />上一步
          </button>
        )}
        {!embedded && (
          <button type="button" className="button button-secondary button-small" onClick={() => onOpen(step)}>
            在官網開啟<Icon name="external" size={14} />
          </button>
        )}
        <button type="button" className="button button-primary button-small guide-next" onClick={() => (single ? onEnd(false) : last ? onEnd(true) : go(index + 1))}>
          {single ? '知道了' : last ? '完成導覽' : '下一步'}<Icon name={last ? 'check' : 'arrow'} size={15} />
        </button>
      </div>
      <p className="guide-disclaimer">{plan.disclaimer}</p>
    </motion.section>
  );
}
