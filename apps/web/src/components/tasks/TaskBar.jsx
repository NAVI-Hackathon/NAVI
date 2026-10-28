import Icon from '../Icon.jsx';
import { stageLabel } from '../../domain/workspace.js';

// Only the document workflow has a readiness score; other services show their stage alone.
const scored = item => item.serviceType === 'hospitalization_claim' && item.supported !== false && item.currentStage !== 'HUMAN_REVIEW';

// Two journeys of the same service are told apart by the hospital, or else by when they were created.
function journeyTitle(item) {
  if (!item.title) return '服務旅程';
  if (item.detail) return `${item.title}・${item.detail}`;
  const created = item.createdAt ? new Date(item.createdAt) : null;
  return created ? `${item.title}・${created.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })} 建立` : item.title;
}

function journeyStatus(item) {
  if (item.unavailable) return '暫時無法讀取，按一下再試';
  return scored(item) ? `${stageLabel(item)}・${item.readiness}%` : stageLabel(item);
}

/**
 * The user's tasks in this browser: journeys read from the server (switch between them) and requests from
 * one message not handled yet (from POST /intelligence/tasks). Nothing here is a local copy of a journey.
 *   variant 'workspace': every journey, the shown one marked, plus the open requests.
 *   variant 'chat': the journeys to go back to (the open requests are offered as chat options instead).
 */
export default function TaskBar({ journeys, openTasks = null, onSwitch, onPickOpen, busy = false, variant = 'workspace' }) {
  const open = variant === 'workspace' ? openTasks?.tasks ?? [] : [];
  // The workspace bar appears once there is something to switch to; the chat list once there is a journey.
  if (variant === 'workspace' ? journeys.length < 2 && !open.length : !journeys.length) return null;
  return (
    <nav className={`task-bar task-bar-${variant}`} aria-label={variant === 'chat' ? '繼續處理先前的事情' : '你的任務'}>
      <p className="eyebrow" aria-hidden="true">{variant === 'chat' ? '繼續處理先前的事情' : '你的任務'}</p>
      <ul>
        {journeys.map(item => (
          <li key={item.id}>
            <button type="button" className={`task-chip ${item.current ? 'is-current' : ''}`} disabled={busy}
              aria-current={item.current ? 'true' : undefined} onClick={() => onSwitch(item.id)}>
              <Icon name={item.unavailable ? 'alert' : 'route'} size={14} />
              <span className="task-chip-title">{journeyTitle(item)}</span>
              <span className="task-chip-state">{item.current ? `目前・${journeyStatus(item)}` : journeyStatus(item)}</span>
            </button>
          </li>
        ))}
        {open.map(task => (
          <li key={task.id}>
            <button type="button" className="task-chip is-open" disabled={busy} onClick={() => onPickOpen(openTasks.split, task)}>
              <Icon name="chat" size={14} />
              <span className="task-chip-title">{task.input}</span>
              <span className="task-chip-state">尚未處理</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
