import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Icon from '../Icon.jsx';
import AnalysisSequence from './AnalysisSequence.jsx';
import AnswerCard from '../knowledge/AnswerCard.jsx';
import { ReadinessRing } from '../workspace/ReadinessPanel.jsx';
import { STARTERS } from '../../domain/followUps.js';
import { isEmbedPath } from '../../services/adapters.js';
import { fadeUp, transition } from '../../motion/tokens.js';

const MAX_LENGTH = 2000;
const embedded = isEmbedPath(location.pathname);

/** Option buttons under NAVI's latest reply. */
function Options({ followUp, disabled, onSend, onHotline }) {
  if (!followUp?.options?.length) return null;
  return (
    <div className="chat-options">
      {followUp.question && <p className="chat-question">{followUp.question}</p>}
      <div className="chat-option-list">
        {followUp.options.map(option => (
          <button key={option.label} type="button" className="chat-option" disabled={disabled}
            onClick={() => (option.action === 'hotline' ? onHotline() : onSend(option.send, option.label))}>
            {option.icon && <Icon name={option.icon} size={15} />}{option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The journey NAVI opened: a compact card in the chat, entered with 開啟工作區. */
function JourneyCard({ message, snapshot, onOpen }) {
  const current = snapshot?.journey.id === message.journeyId ? snapshot.journey : null;
  if (!current) return <p className="chat-text chat-muted">這份服務旅程已由新的旅程取代。</p>;
  return (
    <div className="chat-journey">
      <ReadinessRing value={current.readiness} size={64} compact />
      <div className="chat-journey-body">
        <p className="chat-journey-label">已建立服務旅程</p>
        <p className="chat-journey-title">{current.title}</p>
        <p className="chat-journey-next">下一步：{current.nextAction.title}</p>
      </div>
      <button type="button" className="button button-primary button-small chat-journey-open" onClick={onOpen}>開啟工作區<Icon name="arrow" size={15} /></button>
    </div>
  );
}

function NaviMessage({ message, latest, busy, mode, snapshot, onSend, onNavigate, onHotline, onOpenWorkspace }) {
  const followUp = latest ? message.followUp : null;
  let body = null;
  if (message.kind === 'welcome') {
    body = (
      <>
        <p className="chat-title">嗨，我是 NAVI</p>
        <p className="chat-text">告訴我發生了什麼，我會從官網資料找答案，帶你到正確的地方。也可以直接選一個：</p>
        {latest && <Options followUp={{ options: STARTERS }} disabled={busy} onSend={onSend} onHotline={onHotline} />}
      </>
    );
  } else if (message.kind === 'answers') {
    const first = message.result.results[0];
    body = (
      <>
        {message.notice && <p className="chat-notice" role="note">{message.notice}</p>}
        {message.followUp.showAnswers
          ? <><p className="chat-text">在官網資料中找到：</p><AnswerCard entry={first} onNavigate={onNavigate} compact expandable highlights={message.result.highlights[first.id]} headingLevel={3} /></>
          : null}
      </>
    );
  } else if (message.kind === 'journey') {
    body = <JourneyCard message={message} snapshot={snapshot} onOpen={onOpenWorkspace} />;
  } else {
    body = (
      <>
        <p className={`chat-title tone-${message.tone}`}>{message.tone === 'error' && <Icon name="alert" size={15} />}{message.title}</p>
        <p className="chat-text">{message.body}</p>
        {latest && message.retry && (
          <div className="chat-option-list">
            <button type="button" className="chat-option" disabled={busy} onClick={() => onSend(message.retry.text, message.retry.label)}>重新分析</button>
            {mode !== 'demo' && <a className="chat-option" href="/demo">改用示範模式</a>}
          </div>
        )}
      </>
    );
  }
  return (
    <div className="msg msg-navi">
      <span className="msg-avatar" aria-hidden="true">N</span>
      <div className="msg-bubble">
        {body}
        {/* Older replies keep their question; only the latest offers buttons. */}
        {message.kind !== 'welcome' && (followUp
          ? <Options followUp={followUp} disabled={busy} onSend={onSend} onHotline={onHotline} />
          : message.followUp?.question && <p className="chat-question chat-question-past">{message.followUp.question}</p>)}
      </div>
    </div>
  );
}

/**
 * NAVI landing as a chat: the conversation scrolls above, the input stays at the bottom.
 * Replies come from the official-site search and the backend; option buttons only send text back.
 */
export default function Landing({ messages, analysisPhase, snapshot, mode, onSend, onNavigate, onHotline, onOpenWorkspace, ref }) {
  const [text, setText] = useState('');
  const textarea = useRef(null);
  const composer = useRef(null);
  const end = useRef(null);
  const reduced = useReducedMotion();
  const busy = analysisPhase !== null;
  const latestNavi = [...messages].reverse().find(m => m.role === 'navi')?.id;

  // Keep the newest message in view: at once when returning to the chat, smoothly as it grows.
  const mounted = useRef(false);
  useEffect(() => {
    if (messages.length > 1 || busy) end.current?.scrollIntoView({ block: 'end', behavior: reduced || !mounted.current ? 'auto' : 'smooth' });
    mounted.current = true;
  }, [messages.length, busy, reduced]);

  // Other fixed layers (guide card, toast) sit above the input; share its height.
  useLayoutEffect(() => {
    const node = composer.current;
    if (!node) return undefined;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty('--composer-height', `${node.offsetHeight}px`));
    observer.observe(node);
    root.dataset.view = 'chat';
    return () => { observer.disconnect(); delete root.dataset.view; };
  }, []);

  // Grow with the text up to about five lines.
  useLayoutEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 132)}px`;
  }, [text]);

  function submit(event) {
    event?.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setText('');
    onSend(value);
  }

  return (
    <motion.main
      ref={ref} id="main-content" className="chat"
      initial={{ opacity: 0 }} animate={{ opacity: 1, transition: transition.normal }}
      exit={{ opacity: 0, transition: transition.exit }}
    >
      <div className="chat-thread" role="log" aria-live="polite" aria-label="與 NAVI 的對話">
        <AnimatePresence initial={false}>
          {messages.map(message => (
            <motion.div key={message.id} layout="position" variants={fadeUp} initial="hidden" animate="show">
              {message.role === 'user'
                ? <div className="msg msg-user"><p className="msg-bubble">{message.text}</p></div>
                : <NaviMessage message={message} latest={message.id === latestNavi && !busy} busy={busy} mode={mode} snapshot={snapshot}
                  onSend={onSend} onNavigate={onNavigate} onHotline={onHotline} onOpenWorkspace={onOpenWorkspace} />}
            </motion.div>
          ))}
          {busy && (
            <motion.div key="thinking" className="msg msg-navi" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: transition.enter }} exit={{ opacity: 0, transition: transition.exit }}>
              <span className="msg-avatar" aria-hidden="true">N</span>
              <div className="msg-bubble msg-thinking"><AnalysisSequence phase={analysisPhase} /></div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={end} className="chat-end" />
        {messages.length === 1 && !embedded && <HowItWorks />}
      </div>

      <form ref={composer} className="chat-composer" onSubmit={submit} aria-busy={busy}>
        <div className="chat-composer-box">
          <label className="visually-hidden" htmlFor="story-input">輸入訊息</label>
          <textarea
            id="story-input" ref={textarea} value={text} maxLength={MAX_LENGTH} rows={1}
            placeholder="請輸入內容…" aria-describedby="story-help"
            onChange={e => setText(e.target.value)}
            // Enter sends; Shift+Enter is a new line. Never send while an IME is composing Chinese.
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e); }}
          />
          <button type="submit" className="chat-send" disabled={busy || !text.trim()} aria-label="送出">
            <Icon name="send" size={18} />
          </button>
        </div>
        <p id="story-help" className="chat-help">
          <Icon name="lock" size={12} />
          {mode === 'demo' ? '示範模式：內容只在這個分頁中比對，不會送出。' : '請勿輸入身分證字號、病歷或帳戶資料。'}
        </p>
      </form>
    </motion.main>
  );
}

/** What NAVI does, in three words — each backed by a feature that is actually built. */
function HowItWorks() {
  return (
    <section className="how-it-works" aria-labelledby="how-title">
      <h2 id="how-title" className="how-title">NAVI 怎麼幫你</h2>
      <ol className="how-steps">
        {[
          ['spark', '理解', '用自己的話描述，NAVI 找出你要辦的服務。', '意圖理解・描述先遮蔽個資'],
          ['shield', '檢核', '文件分成已取得、需要補件、需要人工確認，原因一看就懂。', '後端規則判定・不判斷理賠'],
          ['route', '帶你去', '一步一步帶到官網正確的頁面，並附上原文來源。', '可驗證導覽・資料快照摘錄'],
        ].map(([icon, title, body, tech], i) => (
          <li key={title} className="how-step">
            <span className="how-icon"><Icon name={icon} size={18} /></span>
            <p className="how-index">0{i + 1}</p>
            <strong>{title}</strong>
            <p className="how-body">{body}</p>
            <span className="how-tech">{tech}</span>
          </li>
        ))}
      </ol>
      <p className="how-note"><Icon name="book" size={13} />所有說明只引用法國巴黎人壽官網公開資料；不提供投保建議，也不判斷能否理賠。</p>
    </section>
  );
}
