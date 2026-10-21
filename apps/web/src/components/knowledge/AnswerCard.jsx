import Icon from '../Icon.jsx';
import { typeLabels } from '../../../../../shared/knowledge/index.js';
import SourceEvidence from './SourceEvidence.jsx';

export function NavigateButton({ destination, onNavigate }) {
  if (!onNavigate) return null;
  return (
    <button type="button" className="link-button navigate-link" onClick={() => onNavigate(destination)}>
      <Icon name="route" size={13} />帶我去：{destination.label}
    </button>
  );
}

/**
 * One official answer. `compact` (assistant panel) shows the summary or the lines most related
 * to the question (`highlights`); otherwise every detail list.
 */
export default function AnswerCard({ entry, onNavigate, compact = false, highlights = [], headingLevel = 3 }) {
  const Heading = `h${headingLevel}`;
  const details = !compact ? entry.details
    : entry.summary ? []
    : highlights.length ? [{ label: '相關說明', items: highlights }]
    : entry.details.slice(0, 2).map(d => ({ ...d, items: d.items.slice(0, 3) }));
  const summary = entry.summary;
  return (
    <article className={`answer-card${compact ? ' answer-card-compact' : ''}`}>
      <div className="answer-tags">
        <span className="tag tag-quiet">{typeLabels[entry.type]}</span>
        {entry.requiresLogin && <span className="tag">需登入會員</span>}
      </div>
      <Heading className="answer-title">{entry.title}</Heading>
      {summary && <p className="answer-summary">{summary}</p>}
      {details.map(detail => (
        <div key={detail.label} className="answer-detail">
          <p className="answer-detail-label">{detail.label}</p>
          <ul>{detail.items.map(item => <li key={item}>{item}</li>)}</ul>
        </div>
      ))}
      <NavigateButton destination={entry.destination} onNavigate={onNavigate} />
      <SourceEvidence sourceId={entry.id} preferredLines={highlights} fallback={entry.destination.source} />
    </article>
  );
}
