import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Icon from '../Icon.jsx';
import AnalysisSequence from './AnalysisSequence.jsx';
import AnalysisFeedback from './AnalysisFeedback.jsx';
import KnowledgeAnswers from '../knowledge/KnowledgeAnswers.jsx';
import { DEMO_STORY } from '../../mocks/hospitalClaim.js';
import { fadeUp, staggerChildren, transition } from '../../motion/tokens.js';

const scenarios = [
  { id: 'hospital', icon: 'medical', label: '我住院了，想申請理賠', text: DEMO_STORY },
  { id: 'payment', icon: 'card', label: '我想更改繳費方式', text: '我想把保單的繳費方式改成信用卡扣款，要從哪裡開始？' },
  { id: 'address', icon: 'document', label: '我搬家了，想改地址', text: '我最近搬家了，保單上的地址要怎麼改？' },
  { id: 'loan', icon: 'bank', label: '想用保單借錢', text: '我想用保單借錢週轉，要準備什麼？' },
];

const MAX_LENGTH = 2000;

export default function Landing({ analysisPhase, feedback, onStart, onRetry, onClearFeedback, onNavigate, mode, ref }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const textarea = useRef(null);
  const fillFrame = useRef(0);
  const reduced = useReducedMotion();
  const analysing = analysisPhase !== null;

  const below = useRef(null);
  useEffect(() => () => cancelAnimationFrame(fillFrame.current), []);
  // On short screens the analysis status sits below the fold; bring it into view.
  useEffect(() => {
    if (analysing) below.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [analysing, reduced]);

  function fill(scenario) {
    cancelAnimationFrame(fillFrame.current);
    setError(''); onClearFeedback();
    textarea.current?.focus();
    if (reduced) { setText(scenario.text); return; }
    // Quick type-in (~250ms) so the input visibly "receives" the scenario.
    const start = performance.now();
    const tick = now => {
      const t = Math.min(1, (now - start) / 260);
      setText(scenario.text.slice(0, Math.ceil(scenario.text.length * t)));
      if (t < 1) fillFrame.current = requestAnimationFrame(tick);
    };
    fillFrame.current = requestAnimationFrame(tick);
  }

  function submit(event) {
    event.preventDefault();
    cancelAnimationFrame(fillFrame.current);
    if (!text.trim()) { setError('先描述你的情況，或選擇下方的情境。'); textarea.current?.focus(); return; }
    setError('');
    onStart(text);
  }

  return (
    <motion.main
      ref={ref} id="main-content" className="landing"
      initial="hidden" animate="show"
      exit={{ opacity: 0, scale: 0.985, transition: transition.exit }}
      variants={staggerChildren(0.07, 0.05)}
    >
      <div className="ambient-field" aria-hidden="true" />
      <section className="hero" aria-labelledby="hero-title">
        <motion.p className="eyebrow hero-eyebrow" variants={fadeUp}>
          <span className="tiny-line" aria-hidden="true" />NAVI <span className="hero-eyebrow-sep" aria-hidden="true">·</span> AI 智慧服務導航助手
        </motion.p>
        <motion.h1 id="hero-title" variants={fadeUp}>告訴我發生了什麼</motion.h1>
        <motion.p className="hero-subtitle" variants={fadeUp}>
          不用找功能、不用讀完所有說明。<br />NAVI 會理解你的情況，帶你找到下一步。
        </motion.p>

        <motion.form className="composer" variants={fadeUp} onSubmit={submit} aria-busy={analysing}>
          <motion.div className="composer-surface" layoutId="story-surface" transition={transition.layout} aria-hidden="true" />
          <label className="visually-hidden" htmlFor="story-input">描述你的情況</label>
          <textarea
            id="story-input" ref={textarea} value={text} maxLength={MAX_LENGTH} rows={3}
            disabled={analysing} aria-describedby="story-help"
            placeholder="例如：我上週在台中榮總住院五天，要怎麼申請理賠？"
            onChange={e => { cancelAnimationFrame(fillFrame.current); setText(e.target.value); setError(''); onClearFeedback(); }}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }}
          />
          <div className="composer-footer">
            <p id="story-help" className="composer-help">
              <Icon name="lock" size={14} />
              {mode === 'demo' ? '示範模式：描述只在這個分頁中比對，不會送出。' : '描述會交由 AI 分析，請勿填入身分證字號或帳戶資料。'}
            </p>
            <button className="button button-primary composer-submit" type="submit" disabled={analysing}>
              {analysing ? '分析中' : '開始分析'}
              <Icon name="arrow" size={17} />
            </button>
          </div>
        </motion.form>

        <motion.div className="hero-below" ref={below} variants={fadeUp}>
          {error && <p className="inline-error" role="alert"><Icon name="info" size={15} />{error}</p>}
          <AnimatePresence mode="popLayout" initial={false}>
            {analysing ? (
              <AnalysisSequence key="analysis" phase={analysisPhase} />
            ) : feedback?.kind === 'answers' ? (
              <KnowledgeAnswers
                key="answers" result={feedback.result} notice={feedback.notice} onNavigate={onNavigate}
                onEdit={() => { onClearFeedback(); textarea.current?.focus(); }}
              />
            ) : feedback ? (
              <AnalysisFeedback
                key={`feedback-${feedback.kind}`} feedback={feedback} mode={mode}
                onRetry={() => onRetry(text)}
                onEdit={() => { onClearFeedback(); textarea.current?.focus(); }}
              />
            ) : (
              <motion.div key="scenarios" className="scenarios" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: transition.normal }} exit={{ opacity: 0, transition: transition.exit }}>
                <span className="scenarios-label">或從常見情境開始</span>
                <motion.ul className="scenario-list" variants={staggerChildren(0.05)} initial="hidden" animate="show">
                  {scenarios.map(s => (
                    <motion.li key={s.id} variants={fadeUp}>
                      <button type="button" className="scenario-chip" onClick={() => fill(s)}>
                        <Icon name={s.icon} size={17} />{s.label}
                      </button>
                    </motion.li>
                  ))}
                </motion.ul>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </section>

      {/* What NAVI does, in three words — each backed by a feature that is actually built. */}
      <motion.section className="how-it-works" variants={fadeUp} aria-labelledby="how-title">
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
      </motion.section>
    </motion.main>
  );
}
