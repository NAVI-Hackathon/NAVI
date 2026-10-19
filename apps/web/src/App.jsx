import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, useReducedMotion } from 'motion/react';
import AppHeader, { EmbedHeader } from './components/AppHeader.jsx';
import Landing from './components/landing/Landing.jsx';
import Workspace from './components/workspace/Workspace.jsx';
import Toast from './components/Toast.jsx';
import { HandoffDialog, ProceedDialog, ReviewDialog, ServiceDialog } from './components/dialogs/JourneyDialogs.jsx';
import { createApiAdapter, createMockAdapter, isEmbedPath, resolveMode } from './services/adapters.js';
import { useHostBridge } from './hooks/useHostBridge.js';
import { naviMessage, originOf } from '../../../shared/embed.js';
import { analysisErrors } from './services/intelligence.js';
import { serviceLabel } from './domain/intelligence.js';
import { searchKnowledge } from '../../../shared/knowledge/index.js';
import { JOURNEY_EXPIRED_MESSAGE } from './services/apiJourney.js';
import { documentSpecs } from './mocks/hospitalClaim.js';

const embedded = isEmbedPath(location.pathname);
const mode = resolveMode(location);
// Mock insurer site for standalone mode (NextAction links open there in a new tab).
const mockSiteOrigin = originOf(import.meta.env.VITE_MOCK_SITE_URL ?? '');

const errorCopy = {
  ...analysisErrors,
  AI_NOT_CONFIGURED: ['AI 分析服務尚未啟用', '目前無法使用 AI 分析。你可以改用示範模式，體驗完整的服務旅程。'],
  API_UNAVAILABLE: ['分析服務暫時無法使用', '請稍後再試一次，或改用示範模式。'],
  AI_PROVIDER_ERROR: ['分析服務暫時無法回應', '請稍後再試一次，或改用示範模式。'],
};

function feedbackFor(understanding, hotline) {
  if (understanding.meta.outcome === 'clarification') {
    return { kind: 'clarification', title: '我還需要一些資訊', body: '可以再多描述一點嗎？例如發生了什麼事、你想處理哪一件事。' };
  }
  return {
    kind: 'preview',
    title: serviceLabel(understanding.data.serviceType),
    body: `${understanding.data.summary} 官網資料中沒有找到這項需求的說明，你可以換個方式描述，或洽客服專線 ${hotline}。`,
  };
}

// NAVI only quotes the official site: no product advice, no judging whether a claim will be paid.
const guardFeedback = hotline => ({
  kind: 'guard', title: '這個問題需要由專人協助',
  body: `NAVI 只根據法國巴黎人壽官網公開資料提供說明，不提供投保建議，也無法判斷能否理賠或理賠金額。請洽客服專線 ${hotline}。`,
});

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (ms <= 0) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

export default function App() {
  const service = useMemo(() => (mode === 'demo' ? createMockAdapter() : createApiAdapter()), []);
  const [snapshot, setSnapshot] = useState(() => service.restore());
  // Embedded NAVI reopens on the journey in progress (the host page may have reloaded the iframe).
  const [view, setView] = useState(() => ((location.hash === '#workspace' || embedded) && snapshot ? 'workspace' : 'landing'));
  // Formal mode: a stored journey is read back from the server before anything is shown,
  // so the page opens straight on the workspace instead of flashing the landing page.
  const [resuming, setResuming] = useState(() => Boolean(service.hasStoredJourney?.()));
  const [analysisPhase, setAnalysisPhase] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [docStates, setDocStates] = useState({});
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState('journey');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [landingKey, setLandingKey] = useState(0);
  const systemReduced = useReducedMotion();
  const host = useHostBridge(embedded);
  const reduced = reduceMotion || systemReduced;

  const analysisCtl = useRef(null);
  const snapshotRef = useRef(snapshot);
  const fileInputs = useRef({});
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  useEffect(() => { document.documentElement.dataset.reducedMotion = String(reduced); }, [reduced]);
  useEffect(() => { document.documentElement.dataset.embedded = String(embedded); }, []);

  useEffect(() => {
    const onPop = () => {
      analysisCtl.current?.abort();
      setAnalysisPhase(null);
      setDialog(null);
      setView(location.hash === '#workspace' && snapshotRef.current ? 'workspace' : 'landing');
    };
    window.addEventListener('popstate', onPop);
    return () => { window.removeEventListener('popstate', onPop); analysisCtl.current?.abort(); };
  }, []);

  /** The server no longer has this journey (expired or restarted): start over cleanly. */
  const expire = useCallback(() => {
    analysisCtl.current?.abort();
    service.reset();
    setSnapshot(null);
    setDocStates({});
    setDialog(null);
    setAnalysisPhase(null);
    history.replaceState(null, '', location.pathname + location.search);
    setView('landing');
    setFeedback({ kind: 'expired', title: '這份服務旅程已失效', body: `${JOURNEY_EXPIRED_MESSAGE}描述你的情況，就能建立新的服務旅程。` });
  }, [service]);

  // Formal mode keeps only the journey id in the browser; read the journey back after a reload.
  useEffect(() => {
    if (!service.resume) return;
    const ctl = new AbortController();
    service.resume({ signal: ctl.signal }).then(next => {
      if (next && !snapshotRef.current) { // nothing stored, or the user already started a new one
        setSnapshot(next);
        if (location.hash === '#workspace' || embedded) setView('workspace');
      }
      setResuming(false);
    }).catch(error => {
      if (ctl.signal.aborted) return;
      if (error?.code === 'JOURNEY_NOT_FOUND') expire();
      setResuming(false);
    });
    return () => ctl.abort();
  }, [service, expire]);

  /** Run a journey action; server failures become a toast, an expired journey restarts. */
  async function attempt(run) {
    try { return await run(); }
    catch (error) {
      if (error?.code === 'JOURNEY_NOT_FOUND') expire();
      else notify(error?.message && error?.code ? error.message : '目前暫時無法處理，請稍後再試。');
      return null;
    }
  }

  const busyType = Object.entries(docStates).find(([, s]) => s.status === 'processing')?.[0] ?? null;
  const notify = useCallback(message => setToast({ message, key: Date.now() }), []);
  const dismissToast = useCallback(() => setToast(null), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  function goWorkspace() {
    history.pushState(null, '', '#workspace');
    setView('workspace');
    window.scrollTo(0, 0);
  }
  function goLanding() {
    history.pushState(null, '', location.pathname + location.search);
    setView('landing');
    window.scrollTo(0, 0);
  }

  async function start(text) {
    analysisCtl.current?.abort();
    const ctl = new AbortController();
    analysisCtl.current = ctl;
    setFeedback(null);
    const showFeedback = next => {
      setAnalysisPhase(null);
      setFeedback(next);
      requestAnimationFrame(() => document.getElementById('feedback-title')?.focus());
    };
    // Official-site answers are searched locally; refused questions never reach the AI.
    const knowledge = searchKnowledge(text);
    if (knowledge.status === 'out_of_scope') { showFeedback(guardFeedback(knowledge.hotline)); return; }
    const answered = knowledge.status === 'answered';
    setAnalysisPhase(0);
    const step = reduced ? 0 : 640;
    const startedAt = performance.now();
    try {
      // 住院醫療理賠 opens the full journey; other services show the official answers when there are any.
      const openJourney = kind => kind === 'hospital' || !answered;
      const result = await service.analyze(text, { signal: ctl.signal, openJourney });
      await wait(step + 160 - (performance.now() - startedAt), ctl.signal);
      setAnalysisPhase(1);
      await wait(step, ctl.signal);
      if (!result.snapshot) {
        showFeedback(answered ? { kind: 'answers', result: knowledge } : feedbackFor(result.understanding, knowledge.hotline));
        return;
      }
      setAnalysisPhase(2);
      await wait(step, ctl.signal);
      setDocStates({});
      setTab('journey');
      setSnapshot(result.snapshot);
      setAnalysisPhase(null);
      goWorkspace();
    } catch (error) {
      if (ctl.signal.aborted) return;
      // The official answers do not depend on the AI service, so they still help when it is down.
      if (answered) { showFeedback({ kind: 'answers', result: knowledge, notice: 'AI 分析暫時無法使用，以下是官網資料中的相關說明。' }); return; }
      const [title, body] = errorCopy[error?.code] ?? errorCopy.DEFAULT;
      showFeedback({ kind: 'error', title, body });
    }
  }

  async function upload(type, source) {
    if (busyType) return;
    setDocStates(s => ({ ...s, [type]: { status: 'processing' } }));
    try {
      const next = await service.uploadDocument(type, source);
      setSnapshot(next);
      setDocStates(s => ({ ...s, [type]: { status: 'idle' } }));
      const added = next.journey.documents.find(d => d.documentType === type);
      notify(added?.status === 'needs_review' ? `${documentSpecs[type].title}有資料需要確認，已轉由專員協助。` : `${documentSpecs[type].title}已辨識，準備完成度已更新。`);
    } catch (error) {
      if (error?.code === 'JOURNEY_NOT_FOUND') { expire(); return; }
      // Server messages (e.g. 文件類型與目前服務需求不同) are written for the user.
      setDocStates(s => ({ ...s, [type]: { status: 'failed', message: error?.code && error.message ? error.message : null } }));
    } finally {
      setFailNext(false);
    }
  }

  /** Take the user to the step's page on the insurer site (embedded: host navigates; standalone: new tab). */
  const navigate = host.connected
    ? destination => host.send(naviMessage('navi:navigate', { destination }))
    : !embedded && mockSiteOrigin
      ? destination => {
        const url = new URL(destination.path, mockSiteOrigin);
        if (destination.anchor) url.searchParams.set('focus', destination.anchor);
        window.open(url, '_blank', 'noopener');
      }
      : null;

  const actions = {
    // Where uploaded files go differs by mode; say so plainly next to the upload cards.
    documentNotice: service.capabilities.manualEntry
      ? '文件辨識使用示範資料；你的檔案不會被讀取或上傳。'
      : '文件會傳送到 NAVI 服務辨識，不會保存檔案本身；這是示範原型，請勿上傳真實病歷或銀行資料。',
    upload,
    navigate,
    async remove(type) {
      const next = await attempt(() => service.removeDocument(type));
      if (!next) return;
      setSnapshot(next);
      setDocStates(s => ({ ...s, [type]: { status: 'idle' } }));
      notify('文件已移除，準備完成度已更新。');
    },
    // Manual entry exists only where the journey is computed locally (/demo).
    manual: service.capabilities.manualEntry ? (type, fields) => {
      if (!fields) { setDocStates(s => ({ ...s, [type]: { status: 'manual' } })); return; }
      setSnapshot(service.submitManual(type, fields));
      setDocStates(s => ({ ...s, [type]: { status: 'idle' } }));
      notify(`${documentSpecs[type].title}內容已確認，準備完成度已更新。`);
    } : null,
    resetDocument(type) { setDocStates(s => ({ ...s, [type]: { status: 'idle' } })); },
    review() { setDialog('review'); },
    proceed() { setDialog('proceed'); },
    handoff() { setDialog('handoff'); },
    next(action) {
      switch (action.type) {
        case 'UPLOAD_DOCUMENT': {
          const mobile = matchMedia('(max-width: 767.98px)').matches;
          if (mobile) setTab('documents');
          // On mobile the documents tab mounts only after the previous tab's exit animation,
          // so wait until the target input is actually in the DOM before opening the picker.
          const startedAt = performance.now();
          const openPicker = () => {
            const input = fileInputs.current[action.target];
            if (input?.isConnected) {
              input.closest('article')?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
              input.click();
            } else if (performance.now() - startedAt < 1200) {
              setTimeout(openPicker, 50);
            }
          };
          setTimeout(openPicker, 0);
          break;
        }
        case 'PROVIDE_INFORMATION':
          if (action.target === 'inpatient_info' && service.capabilities.manualEntry) setDocStates(s => ({ ...s, diagnosis_certificate: { status: 'manual' } }));
          break;
        case 'REVIEW_INFORMATION': setDialog('review'); break;
        case 'PROCEED_TO_SERVICE': setDialog(snapshot?.context.kind === 'hospital' ? 'proceed' : 'service'); break;
        case 'NONE': break;
        default: setDialog('handoff');
      }
    },
  };

  function reset() {
    analysisCtl.current?.abort();
    service.reset();
    setSnapshot(null);
    setAnalysisPhase(null);
    setFeedback(null);
    setDocStates({});
    setDialog(null);
    setLandingKey(k => k + 1);
    goLanding();
    notify('已重新開始，可以描述新的情況。');
  }

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">跳至主要內容</a>
        {embedded ? (
          <EmbedHeader
            mode={mode} view={view} hasJourney={Boolean(snapshot)} busy={analysisPhase !== null || Boolean(busyType)}
            onHome={goLanding} onResume={goWorkspace} onReset={reset}
            onClose={host.connected ? () => host.send(naviMessage('navi:close')) : null}
          />
        ) : (
          <AppHeader
            mode={mode} view={view} hasJourney={Boolean(snapshot)} busy={analysisPhase !== null || Boolean(busyType)}
            onHome={goLanding} onResume={goWorkspace} onReset={reset}
            reduceMotion={reduceMotion} onReduceMotion={setReduceMotion}
            failNext={failNext} onFailNext={value => { setFailNext(value); service.setFailNextDocument(value); }}
          />
        )}
        {mode === 'demo' && !embedded && (
          <p className="demo-banner" role="note">示範模式：使用示範資料展示完整流程，不連線 AI，也不會送出任何申請。</p>
        )}

        {resuming ? (
          <main id="main-content" className="resuming" aria-busy="true">
            <p role="status"><span className="dots" aria-hidden="true"><i /><i /><i /></span>正在讀取你的服務旅程…</p>
          </main>
        ) : (
        <LayoutGroup>
          <AnimatePresence mode="popLayout" initial={false}>
            {view === 'workspace' && snapshot ? (
              <Workspace
                key="workspace" snapshot={snapshot} docStates={docStates} busy={busyType}
                tab={tab} onTab={setTab} assistantOpen={assistantOpen} onAssistantOpen={setAssistantOpen}
                actions={actions} registerInput={(type, el) => { fileInputs.current[type] = el; }}
              />
            ) : (
              <Landing
                key={`landing-${landingKey}`} mode={mode} analysisPhase={analysisPhase} feedback={feedback}
                onStart={start} onRetry={start} onClearFeedback={() => setFeedback(null)} onNavigate={navigate}
              />
            )}
          </AnimatePresence>
        </LayoutGroup>
        )}

        <AnimatePresence>
          {snapshot && dialog === 'review' && (
            <ReviewDialog key="review" snapshot={snapshot} onClose={closeDialog}
              onConfirm={async () => {
                const next = await attempt(() => service.confirm());
                if (!next) return;
                setSnapshot(next); setDialog(null); notify('資料已確認，準備完成度已達 100%。');
              }}
              onProceed={() => setDialog('proceed')} />
          )}
          {snapshot && dialog === 'proceed' && (
            <ProceedDialog key="proceed" snapshot={snapshot} onClose={closeDialog} onNavigate={navigate}
              onDone={() => { setDialog(null); notify('服務導引已完成，案件資料保留在這個分頁。'); }} />
          )}
          {snapshot && dialog === 'handoff' && (
            <HandoffDialog key="handoff" snapshot={snapshot} onClose={closeDialog} onPrepared={() => setSnapshot(service.requestHandoff())} />
          )}
          {snapshot && dialog === 'service' && (
            <ServiceDialog key="service" snapshot={snapshot} onClose={closeDialog} onHandoff={() => setDialog('handoff')} />
          )}
        </AnimatePresence>

        <div className="toast-region" aria-live="polite">
          <AnimatePresence>{toast && <Toast key={toast.key} message={toast.message} onDismiss={dismissToast} />}</AnimatePresence>
        </div>
      </div>
    </MotionConfig>
  );
}
