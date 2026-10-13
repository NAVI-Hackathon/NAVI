import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Icon from '../Icon.jsx';
import AssistantPanel from './AssistantPanel.jsx';
import JourneyTimeline from './JourneyTimeline.jsx';
import ReadinessPanel, { ReadinessRing } from './ReadinessPanel.jsx';
import NextActionCard from './NextActionCard.jsx';
import DocumentCard from './DocumentCard.jsx';
import { useBreakpoint } from '../../hooks/useBreakpoint.js';
import { DOCUMENT_TYPES } from '../../mocks/hospitalClaim.js';
import { transition } from '../../motion/tokens.js';

const mobileTabs = [
  { id: 'journey', label: '旅程', icon: 'route' },
  { id: 'documents', label: '文件', icon: 'document' },
  { id: 'assistant', label: 'AI 助手', icon: 'spark' },
];

function stateLabel(journey) {
  return {
    EVIDENCE_COLLECTION: '正在準備資料',
    READY_FOR_REVIEW: '可以進行確認',
    READY_TO_PROCEED: '資料已準備完成',
    HUMAN_REVIEW: '需要專員確認',
    SERVICE_IDENTIFIED: '已找到相關服務',
  }[journey.currentStage] ?? '旅程已建立';
}

export function DocumentList({ snapshot, docStates, busy, actions, registerInput }) {
  return (
    <div className="doc-list">
      {DOCUMENT_TYPES.map(type => (
        <DocumentCard
          key={type} type={type}
          document={snapshot.journey.documents.find(d => d.documentType === type)}
          uiState={docStates[type]} busy={busy}
          onUpload={actions.upload} onRemove={actions.remove} onManual={actions.manual} onRetry={actions.resetDocument}
          registerInput={registerInput}
        />
      ))}
      <p className="doc-privacy"><Icon name="lock" size={13} />{actions.documentNotice}</p>
    </div>
  );
}

export default function Workspace({ snapshot, docStates, busy, tab, onTab, assistantOpen, onAssistantOpen, actions, registerInput, ref }) {
  const breakpoint = useBreakpoint();
  const { journey, context } = snapshot;
  const hasDocuments = context.kind === 'hospital' && journey.currentStage !== 'HUMAN_REVIEW';
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  const documents = hasDocuments ? <DocumentList snapshot={snapshot} docStates={docStates} busy={busy} actions={actions} registerInput={registerInput} /> : null;
  const timeline = (withDocuments) => (
    <JourneyTimeline snapshot={snapshot} documentsSlot={withDocuments ? documents : null}
      onReview={actions.review} onProceed={actions.proceed} onViewService={() => actions.next(journey.nextAction)} onNavigate={actions.navigate} />
  );
  const readiness = (props = {}) => (
    <ReadinessPanel snapshot={snapshot} busy={busy} onAction={actions.next} onSample={type => actions.upload(type, { sample: true })} onHandoff={actions.handoff} onNavigate={actions.navigate} {...props} />
  );
  const assistant = <AssistantPanel snapshot={snapshot} onHandoff={actions.handoff} onNavigate={actions.navigate} />;

  return (
    <motion.main
      ref={ref} id="main-content" className={`workspace bp-${breakpoint}`}
      initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1, transition: { ...transition.slow, delay: 0.05 } }}
      exit={{ opacity: 0, transition: transition.exit }}
    >
      <div className="workspace-head">
        <div>
          <p className="eyebrow">你的服務工作區</p>
          <h1 ref={heading} tabIndex={-1}>{journey.title}</h1>
        </div>
        <div className="workspace-meta">
          <span className={`state-pill stage-${journey.currentStage.toLowerCase()}`}><span className="pulse-dot" aria-hidden="true" />{stateLabel(journey)}</span>
          {breakpoint === 'tablet' && (
            <button type="button" className="button button-secondary button-small" aria-expanded={assistantOpen} aria-controls="assistant-drawer" onClick={() => onAssistantOpen(!assistantOpen)}>
              <Icon name="spark" size={15} />{assistantOpen ? '收合 AI 助手' : 'AI 助手'}
            </button>
          )}
        </div>
      </div>

      {breakpoint === 'desktop' && (
        <div className="workspace-grid">
          {assistant}
          {timeline(true)}
          {readiness()}
        </div>
      )}

      {breakpoint === 'tablet' && (
        <div className={`workspace-grid ${assistantOpen ? 'with-assistant' : ''}`}>
          <AnimatePresence initial={false}>
            {assistantOpen && (
              <motion.div id="assistant-drawer" className="assistant-drawer"
                initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0, transition: transition.enter }} exit={{ opacity: 0, x: -16, transition: transition.exit }}>
                {assistant}
              </motion.div>
            )}
          </AnimatePresence>
          {timeline(true)}
          {readiness()}
        </div>
      )}

      {breakpoint === 'mobile' && (
        <>
          <nav className="mobile-tabs" role="tablist" aria-label="工作區檢視">
            {mobileTabs.map(item => (
              <button key={item.id} id={`tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls={`tabpanel-${item.id}`} onClick={() => onTab(item.id)}>
                <Icon name={item.icon} size={16} />{item.label}
                {item.id === 'documents' && hasDocuments && <span className="tab-count">{journey.documents.length}/{DOCUMENT_TYPES.length}</span>}
                {tab === item.id && <motion.span className="tab-indicator" layoutId="tab-indicator" transition={transition.normal} />}
              </button>
            ))}
          </nav>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} id={`tabpanel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="mobile-panel"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: transition.enter }} exit={{ opacity: 0, transition: transition.exit }}>
              {tab === 'journey' && (
                <>
                  {hasDocuments && (
                    <section className="panel mobile-readiness" aria-label="準備完成度">
                      <ReadinessRing value={journey.readiness} size={96} compact />
                      <NextActionCard action={journey.nextAction} complete={journey.currentStage === 'READY_TO_PROCEED'} busy={busy} onAction={actions.next} onSample={type => actions.upload(type, { sample: true })} onNavigate={actions.navigate} />
                    </section>
                  )}
                  {!hasDocuments && readiness()}
                  {timeline(false)}
                </>
              )}
              {tab === 'documents' && (hasDocuments ? documents : readiness({ showNextAction: false }))}
              {tab === 'assistant' && assistant}
            </motion.div>
          </AnimatePresence>
        </>
      )}

      <footer className="workspace-footer">
        <span><Icon name="lock" size={13} />進度只保留在這個分頁；文件不會被上傳。</span>
        <span>NAVI · 智慧服務導航</span>
      </footer>
    </motion.main>
  );
}
