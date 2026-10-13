import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Icon from '../Icon.jsx';
import AnswerCard from '../knowledge/AnswerCard.jsx';
import { assistantQuestions } from '../../mocks/hospitalClaim.js';
import { retrievedAt } from '../../content/cardifData.js';
import { searchKnowledge } from '../../domain/knowledge.js';
import { crossfade, fadeUp, staggerChildren, transition } from '../../motion/tokens.js';

function suggestionFor(snapshot) {
  const { journey } = snapshot;
  if (journey.currentStage === 'HUMAN_REVIEW') return '這個情況需要專員確認。你可以先下載服務摘要，聯繫時就不用重新說明。';
  if (snapshot.context.kind !== 'hospital') return journey.nextAction.description;
  const target = journey.nextAction.target;
  if (target === 'diagnosis_certificate') return '先從診斷書開始：它能確認醫院、住院期間與病名，是後續申請的主要文件。';
  if (target === 'bank_passbook') return '理賠金以匯款給付，準備好存摺封面影本，確認戶名與帳號清楚可辨識。';
  if (journey.nextAction.type === 'REVIEW_INFORMATION') return '兩份文件都已辨識。確認資料無誤後，記得下載並填妥保險金申請書。';
  return journey.nextAction.description;
}

// Answers are quoted from data/cardif_seed_data.json (domain/knowledge.js); NAVI never writes its own policy text.
function answerFor(question) {
  const result = searchKnowledge(question, { limit: 2 });
  if (result.status === 'answered') return { entries: result.results, highlights: result.highlights };
  if (result.status === 'out_of_scope') return { text: `NAVI 不提供投保建議，也無法判斷能否理賠或理賠金額。請洽客服專線 ${result.hotline}。` };
  return { text: `官網資料中沒有找到相關說明，建議換個說法，或洽客服專線 ${result.hotline}。` };
}

export default function AssistantPanel({ snapshot, onHandoff, onNavigate }) {
  const { journey, context } = snapshot;
  const isHospital = context.kind === 'hospital';
  const hospital = journey.claimContext?.hospital;
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState([]);
  const [thinking, setThinking] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  function ask(text) {
    const q = text.trim();
    if (!q || thinking) return;
    setQuestion(''); setThinking(true);
    timer.current = setTimeout(() => { setAnswers(list => [...list, { q, ...answerFor(q) }]); setThinking(false); }, 450);
  }

  const facts = [
    ['已辨識服務', journey.title],
    ...(isHospital ? [['住院醫院', hospital ? (hospital.matchedName ?? hospital.mentioned) : '待確認'], ['醫起通', hospital ? (hospital.partner ? '合作醫院' : '未對應合作院所') : '待確認']] : []),
  ];

  return (
    <aside className="panel assistant-panel" aria-labelledby="assistant-title">
      <header className="panel-header">
        <h2 id="assistant-title"><Icon name="spark" size={17} />AI 服務助手</h2>
      </header>

      <motion.div className="assistant-sections" initial="hidden" animate="show" variants={staggerChildren(0.07, 0.15)}>
        <motion.section className="story-card" variants={fadeUp} aria-label="你的描述">
          <motion.div className="story-surface" layoutId="story-surface" transition={transition.layout} aria-hidden="true" />
          <p className="eyebrow">你的描述</p>
          <p className="story-text">{context.story}</p>
        </motion.section>

        <motion.section className="insight" variants={fadeUp} aria-labelledby="insight-title">
          <h3 id="insight-title" className="section-label">NAVI 的理解</h3>
          <p className="insight-summary">{journey.summary}</p>
          <dl className="insight-facts">
            {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            <div>
              <dt>判讀方式</dt>
              <dd>{context.source === 'demo_fallback' ? <span className="tag">示範判讀・未使用 AI</span> : `AI 判讀・信心 ${Math.round(journey.confidence * 100)}%`}</dd>
            </div>
          </dl>
        </motion.section>

        <motion.section className="suggestion" variants={fadeUp} aria-labelledby="suggestion-title">
          <h3 id="suggestion-title" className="section-label">建議</h3>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p key={`${journey.nextAction.type}-${journey.nextAction.target}`} {...crossfade}>{suggestionFor(snapshot)}</motion.p>
          </AnimatePresence>
          {journey.currentStage === 'HUMAN_REVIEW' && (
            <button type="button" className="button button-secondary button-small" onClick={onHandoff}>準備服務摘要<Icon name="chevron" size={14} /></button>
          )}
        </motion.section>

        {isHospital && journey.claimContext.reminders.length > 0 && (
          <motion.section className="reminders" variants={fadeUp} aria-labelledby="reminders-title">
            <h3 id="reminders-title" className="section-label">容易漏掉的提醒</h3>
            <ul>{journey.claimContext.reminders.map(r => <li key={r}>{r}</li>)}</ul>
          </motion.section>
        )}

        {(journey.officialSources?.length ?? 0) > 0 && (
          <motion.section className="sources" variants={fadeUp} aria-labelledby="sources-title">
            <h3 id="sources-title" className="section-label">資料來源</h3>
            <ul>
              {journey.officialSources.map(source => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="source-link">
                    <Icon name="book" size={14} />法國巴黎人壽官網・{source.title}<Icon name="external" size={13} className="summary-chevron" />
                  </a>
                  <p className="source-section">擷取日期 {source.retrievedAt}</p>
                </li>
              ))}
            </ul>
          </motion.section>
        )}

        <motion.section className="ask" variants={fadeUp} aria-labelledby="ask-title">
          <h3 id="ask-title" className="section-label">想進一步了解</h3>
          <div className="ask-log" aria-live="polite">
            {answers.map((a, i) => (
              <motion.div key={i} className="qa" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: transition.enter }}>
                <p className="qa-q">{a.q}</p>
                {a.text && <p className="qa-a">{a.text}</p>}
                {a.entries?.map(entry => <AnswerCard key={entry.id} entry={entry} onNavigate={onNavigate} compact highlights={a.highlights[entry.id]} headingLevel={4} />)}
              </motion.div>
            ))}
            {thinking && <p className="qa-thinking" role="status"><span className="dots" aria-hidden="true"><i /><i /><i /></span>正在整理說明</p>}
          </div>
          <div className="ask-suggestions">
            {isHospital && assistantQuestions.filter(item => !answers.some(a => a.q === item.question)).map(item => (
              <button key={item.id} type="button" className="chip" disabled={thinking} onClick={() => ask(item.question)}>{item.question}</button>
            ))}
          </div>
          <form className="ask-form" onSubmit={e => { e.preventDefault(); ask(question); }}>
            <label className="visually-hidden" htmlFor="ask-input">詢問 NAVI</label>
            <input id="ask-input" value={question} maxLength={300} placeholder="詢問文件或申請方式…" onChange={e => setQuestion(e.target.value)} />
            <button type="submit" className="icon-button icon-button-filled" aria-label="送出問題" disabled={!question.trim() || thinking}><Icon name="arrow" size={16} /></button>
          </form>
          <p className="ask-note">回答引用自法國巴黎人壽官網公開資料（擷取 {retrievedAt}）。</p>
        </motion.section>
      </motion.div>
    </aside>
  );
}
