import { useEffect, useRef } from 'react';
import Icon, { Mark } from './Icon.jsx';

export default function AppHeader({ mode, demoData = false, view, hasJourney, busy, onHome, onResume, onReset, onSearch, onPrivacy, reduceMotion, onReduceMotion, failNext, onFailNext }) {
  const menu = useRef(null);
  useEffect(() => {
    function dismiss(e) {
      if (!menu.current?.open) return;
      if (e.type === 'keydown' && e.key === 'Escape') { menu.current.open = false; menu.current.querySelector('summary')?.focus(); }
      if (e.type === 'pointerdown' && !menu.current.contains(e.target)) menu.current.open = false;
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', dismiss); };
  }, []);
  const close = action => () => { if (menu.current) menu.current.open = false; action(); };

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <button type="button" className="brand" onClick={onHome} disabled={busy} aria-label="回到 NAVI 首頁">
          <Mark />
          <span className="wordmark">NAVI<small>AI Service Journey Navigator</small></span>
        </button>
        {mode === 'demo' && <span className="mode-badge" title="使用示範資料，不連線 AI">示範模式</span>}
        {mode !== 'demo' && demoData && <span className="mode-badge" title="NAVI 服務目前以示範資料回答，不是 AI 分析">示範資料</span>}

        <div className="app-header-actions">
          {hasJourney && view === 'landing' && (
            <button type="button" className="button button-ghost button-small" disabled={busy} onClick={onResume}>回到我的旅程<Icon name="arrow" size={14} /></button>
          )}
          <button type="button" className="icon-button" onClick={onSearch} aria-label="找服務"><Icon name="search" size={18} /></button>
          <details className="menu" ref={menu}>
            <summary className="icon-button" aria-label="更多選項"><Icon name="more" size={20} /></summary>
            <div className="menu-popover" role="group" aria-label="更多選項">
              <button type="button" onClick={close(onPrivacy)}><Icon name="lock" size={16} />資料與隱私</button>
              <button type="button" onClick={close(onReset)}><Icon name="reset" size={16} />重新開始</button>
              <label className="menu-toggle"><input type="checkbox" checked={reduceMotion} onChange={e => onReduceMotion(e.target.checked)} />減少動畫</label>
              {mode === 'demo' && (
                <label className="menu-toggle"><input type="checkbox" checked={failNext} onChange={e => onFailNext(e.target.checked)} />下一次文件辨識失敗</label>
              )}
              <hr />
              <a href={mode === 'demo' ? '/' : '/demo'}><Icon name="external" size={16} />{mode === 'demo' ? '切換到一般模式（AI 分析）' : '切換到示範模式'}</a>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

/** Compact header for NAVI inside a host website's side panel. */
export function EmbedHeader({ mode, view, hasJourney, busy, onHome, onResume, onReset, onSearch, onPrivacy, onClose }) {
  return (
    <header className="embed-header">
      <button type="button" className="brand" onClick={onHome} disabled={busy} aria-label="回到 NAVI 首頁">
        <Mark />
        <span className="wordmark">NAVI<small>服務導航助手</small></span>
      </button>
      {mode === 'demo' && <span className="mode-badge" title="使用示範資料，不連線 AI">示範</span>}
      <div className="embed-header-actions">
        {hasJourney && view === 'landing' && (
          <button type="button" className="icon-button" disabled={busy} onClick={onResume} aria-label="回到我的旅程"><Icon name="route" size={17} /></button>
        )}
        <button type="button" className="icon-button" onClick={onSearch} aria-label="找服務"><Icon name="search" size={17} /></button>
        <button type="button" className="icon-button" onClick={onPrivacy} aria-label="資料與隱私"><Icon name="lock" size={17} /></button>
        <button type="button" className="icon-button" onClick={onReset} aria-label="重新開始"><Icon name="reset" size={17} /></button>
        {onClose && <button type="button" className="icon-button" onClick={onClose} aria-label="關閉 NAVI"><Icon name="close" size={18} /></button>}
      </div>
    </header>
  );
}
