import { motion } from 'motion/react';
import Icon from '../Icon.jsx';
import SourceEvidence from '../knowledge/SourceEvidence.jsx';
import { officialSourcesOf, openConditions } from '../../domain/workspace.js';
import { fadeUp, staggerChildren } from '../../motion/tokens.js';

const serviceIcons = { hospital: 'medical', payment_method_change: 'card', unknown: 'headset' };

/**
 * Compact workspace (services without a document workflow, or a case waiting for a specialist):
 * what NAVI understood, what is still open and the official sources (the stage is in the workspace head) —
 * all read from the journey; no stages or percentage invented for services that have none.
 */
export default function ServiceBrief({ snapshot, onNavigate }) {
  const { journey, context } = snapshot;
  const conditions = openConditions(journey);
  const sources = officialSourcesOf(journey);

  return (
    <section className="panel journey-panel service-brief" aria-labelledby="brief-title">
      <header className="panel-header journey-header">
        <div>
          <p className="eyebrow">目前服務</p>
          <h2 id="brief-title" className="journey-service">
            <span className="service-icon"><Icon name={serviceIcons[context.kind] ?? 'route'} size={18} /></span>
            {journey.title}
          </h2>
        </div>
      </header>

      <motion.div className="brief-sections" initial="hidden" animate="show" variants={staggerChildren(0.07, 0.08)}>
        <motion.section variants={fadeUp} aria-labelledby="brief-summary">
          <h3 id="brief-summary" className="section-label"><Icon name="spark" size={13} />NAVI 理解的需求</h3>
          <p className="brief-text">{journey.summary}</p>
        </motion.section>

        <motion.section variants={fadeUp} aria-labelledby="brief-conditions">
          <h3 id="brief-conditions" className="section-label"><Icon name="info" size={13} />待確認條件</h3>
          {conditions.length > 0 ? (
            <ul className="brief-conditions">
              {conditions.map(item => <li key={item.id} className={`is-${item.tone}`}>{item.text}</li>)}
            </ul>
          ) : (
            <p className="brief-text is-muted">目前沒有待確認的條件。實際辦理條件仍以官網與保險公司說明為準。</p>
          )}
        </motion.section>

        <motion.section variants={fadeUp} aria-labelledby="brief-sources">
          <h3 id="brief-sources" className="section-label"><Icon name="book" size={13} />官方資料來源</h3>
          {sources.length > 0 ? (
            <div className="brief-sources">
              {sources.map(source => <SourceEvidence key={source.key} sourceId={source.sourceId} fallback={source.fallback} onNavigate={onNavigate} />)}
            </div>
          ) : (
            <p className="brief-text is-muted">這項需求在官網資料中沒有對應的說明，請洽客服專線由專人協助。</p>
          )}
        </motion.section>
      </motion.div>

      <p className="safe-note"><Icon name="shield" size={15} />{journey.disclaimer}</p>
    </section>
  );
}
