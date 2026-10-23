import { useState } from 'react';
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
export default function AnswerCard({ entry, onNavigate, compact = false, expandable = false, highlights = [], headingLevel = 3 }) {
  const Heading = `h${headingLevel}`;
  // `expandable` (chat): start with the short version, 看完整說明 shows every detail list.
  const [expanded, setExpanded] = useState(false);
  const short = compact && !expanded;
  // Short version: the lines most related to the question, otherwise the first list — never only a lead-in.
  const details = !short ? entry.details
    : highlights.length ? [{ label: '重點', items: highlights.slice(0, 3) }]
    : entry.details.slice(0, entry.summary ? 1 : 2).map(d => ({ ...d, items: d.items.slice(0, 3) }));
  const hasMore = expandable && compact && entry.details.some(d => d.items.length) && details.reduce((n, d) => n + d.items.length, 0) < entry.details.reduce((n, d) => n + d.items.length, 0);
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
      {(hasMore || expanded) && (
        <button type="button" className="link-button answer-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          {expanded ? '收合' : '看完整說明'}<Icon name="chevron" size={12} className={expanded ? 'is-open' : ''} />
        </button>
      )}
      <NavigateButton destination={entry.destination} onNavigate={onNavigate} />
      <SourceEvidence sourceId={entry.id} preferredLines={highlights} fallback={entry.destination.source} />
    </article>
  );
}
