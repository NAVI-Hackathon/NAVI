import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useReducedMotion } from 'motion/react';
import ProductDataDialog from './components/dialogs/ProductDataDialog.jsx';
import AccountRecoveryDialog from './components/dialogs/AccountRecoveryDialog.jsx';
import ServiceWorkflow from './components/workspace/ServiceWorkflow.jsx';
import AppHeader, { EmbedHeader } from './components/AppHeader.jsx';
import Landing from './components/landing/Landing.jsx';
import Workspace from './components/workspace/Workspace.jsx';
import Toast from './components/Toast.jsx';
import { CorrectionDialog, HandoffDialog, ProceedDialog, ReviewDialog, ServiceDialog } from './components/dialogs/JourneyDialogs.jsx';
import { createApiAdapter, createMockAdapter, isEmbedPath, resolveMode } from './services/adapters.js';
import { useHostBridge } from './hooks/useHostBridge.js';
import { naviMessage, originOf } from '../../../shared/embed.js';
import { analysisErrors } from './services/intelligence.js';
import { serviceLabel } from './domain/intelligence.js';
import { knowledgeEntries, searchKnowledge } from '../../../shared/knowledge/index.js';
import { followUpForAnswers, followUpForClarification, followUpForRefusal } from './domain/followUps.js';
import GuideCard from './components/guide/GuideCard.jsx';
import TaskBar from './components/tasks/TaskBar.jsx';
import { transition } from './motion/tokens.js';
import { JOURNEY_EXPIRED_MESSAGE, journeySummary, understandingOfTask } from './services/apiJourney.js';
import { documentSpecs } from './mocks/hospitalClaim.js';

const embedded = isEmbedPath(location.pathname);
const mode = resolveMode(location);
// Mock insurer site for standalone mode (NextAction links open there in a new tab).
const mockSiteOrigin = originOf(import.meta.env.VITE_MOCK_SITE_URL ?? '');

// Where the full flow runs on synthetic data without the AI service (embedded: the insurer site's demo entry).
const demoEntry = embedded && mockSiteOrigin ? `${mockSiteOrigin}/?navi=demo` : `${location.origin}/demo`;
const tryDemo = `想先看完整流程，可以改用示範模式（${demoEntry}）。`;

const errorCopy = {
  ...analysisErrors,
  AI_BUSY: ['NAVI 正在處理其他分析', '請稍候幾秒，再按「重新分析」。'],
  AI_DAILY_LIMIT_REACHED: ['今日 AI 分析次數已用完', `這個原型只使用免費額度，明天會重新開放。${tryDemo}`],
  AI_SESSION_LIMIT_REACHED: ['這次體驗的 AI 分析次數已用完', `為保留免費額度，每次體驗的分析次數有上限，約一小時後可再試。${tryDemo}`],
  AI_UNAVAILABLE: ['AI 分析服務暫時無法使用', `請稍後再試一次。${tryDemo}`],
  AI_USAGE_UNAVAILABLE: ['AI 分析暫時關閉', `目前無法確認免費額度，為避免產生費用已暫停分析。${tryDemo}`],
  TEST_SESSION_REQUIRED: ['這項功能目前僅限授權測試', `請勿輸入或上傳真實資料。${tryDemo}`],
  TEST_SESSION_DENIED: ['這項功能目前僅限授權測試', `請勿輸入或上傳真實資料。${tryDemo}`],
  AI_NOT_CONFIGURED: ['AI 分析服務尚未啟用', '目前無法使用 AI 分析。你可以改用示範模式，體驗完整的服務旅程。'],
  API_UNAVAILABLE: ['分析服務暫時無法使用', '請稍後再試一次，或改用示範模式。'],
  AI_PROVIDER_ERROR: ['分析服務暫時無法回應', '請稍後再試一次，或改用示範模式。'],
  // The server's receipt for a chosen task lasts 5 minutes; nothing is re-sent on its own.
  INTENT_RECEIPT_REQUIRED: ['這件事的需求分析已失效', '從分析到選擇超過 5 分鐘，或內容已改變。按「重新分析」，NAVI 會再理解一次這件事；其他尚未處理的事情仍會保留。'],
};

// NAVI's chat replies. Answers are quoted from official data; NAVI never writes policy text itself.
function replyFor(understanding, askedText, hotline) {
  if (understanding.meta.outcome === 'clarification') {
    return { kind: 'note', tone: 'info', title: '我還需要一些資訊', body: '可以再多描述一點，或直接選一個：', followUp: followUpForClarification(askedText) };
  }
  return {
    kind: 'note', tone: 'info', title: serviceLabel(understanding.data.serviceType),
    body: `${understanding.data.summary} 官網資料中沒有找到這項需求的說明，你可以換個方式描述，或洽客服專線 ${hotline}。`,
    followUp: followUpForRefusal(),
  };
}

// NAVI only quotes the official site: no product advice, no judging whether a claim will be paid.
const guardReply = hotline => ({
  kind: 'note', tone: 'guard', title: '這個問題需要由專人協助',
  body: `NAVI 只根據官網公開資料說明，不提供投保建議，也無法判斷能否理賠或理賠金額。請洽客服專線 ${hotline}。`,
  followUp: followUpForRefusal(),
});

const welcome = () => [{ id: 'welcome', role: 'navi', kind: 'welcome' }];

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (ms <= 0) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

export default function App() {
  const service = useMemo(() => (mode === 'demo' ? createMockAdapter() : createApiAdapter()), []);
  const [recovery,setRecovery]=useState(()=>{const action=new URLSearchParams(location.search).get('auth'),token=new URLSearchParams(location.hash.slice(1)).get('token');return service.mode==='live'&&['verify','reset'].includes(action)&&/^[a-f0-9]{64}$/.test(token??'')?{action,token}:null;});
  const [productReady,setProductReady]=useState(false);
  const [productDialog,setProductDialog]=useState(null);
  const [snapshot, setSnapshot] = useState(() => service.restore());
  // Embedded NAVI reopens on the journey in progress (the host page may have reloaded the iframe).
  const [view, setView] = useState(() => ((location.hash === '#workspace' || embedded) && snapshot ? 'workspace' : 'landing'));
  // Formal mode: a stored journey is read back from the server before anything is shown,
  // so the page opens straight on the workspace instead of flashing the landing page.
  const [resuming, setResuming] = useState(() => Boolean(service.hasStoredJourney?.()));
  const [analysisPhase, setAnalysisPhase] = useState(null);
  const [messages, setMessages] = useState(welcome); // the chat on the landing page
  const messageId = useRef(0);
  const [docStates, setDocStates] = useState({});
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState('journey');
  const [explanation, setExplanation] = useState(null);
  const [guide, setGuide] = useState(null); // { plan, index } while a step-by-step guide is open
  const [guidePending, setGuidePending] = useState(false); // plan request slower than a blink
  const [assistantOpen, setAssistantOpen] = useState(false);
  // Requests from one message not handled yet (from POST /intelligence/tasks), and this browser's journeys
  // as the server has them (formal mode). Neither is a local copy of journey state.
  const [openTasks, setOpenTasks] = useState(null);
  const [journeys, setJourneys] = useState([]);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const systemReduced = useReducedMotion();
  const host = useHostBridge(embedded);
  const reduced = reduceMotion || systemReduced;

  const analysisCtl = useRef(null);
  const snapshotRef = useRef(snapshot);
  const fileInputs = useRef({});
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  useEffect(() => { document.documentElement.dataset.reducedMotion = String(reduced); }, [reduced]);
  useEffect(() => { document.documentElement.dataset.embedded = String(embedded); }, []);
  useEffect(() => { document.documentElement.dataset.guide = String(Boolean(guide)); }, [guide]);

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

  useEffect(()=>{if(!service.init)return;let disposed=false;service.init().then(data=>{if(!data||disposed)return;setProductReady(true);if(data.conversation?.messages)setMessages([{id:'welcome',role:'navi',kind:'welcome'},...data.conversation.messages.map((m,i)=>({id:'stored-'+i,role:m.role==='user'?'user':'navi',kind:'note',tone:'info',title:m.role==='user'?undefined:'先前的對話',text:m.text,body:m.text}))]);}).catch(()=>{});return()=>{disposed=true;};},[service]);

  useEffect(()=>{const change=e=>{if(e.key==='navi.identity.updated'&&service.mode==='live'){service.reset();location.reload();}};window.addEventListener('storage',change);return()=>window.removeEventListener('storage',change);},[service]);

  // Formal mode: the server explains each requirement (reason code, earned points) for the Preflight board.
  // Until it arrives — and always in /demo — the board uses the local mirror of the same rules.
  useEffect(() => {
    if (snapshot?.context.kind !== 'hospital') return undefined;
    const ctl = new AbortController();
    service.explain({ signal: ctl.signal }).then(setExplanation).catch(() => { /* the board falls back to local rules */ });
    return () => ctl.abort();
  }, [service, snapshot]);

  /** The server no longer has this journey (expired or restarted): start over cleanly. */
  const expire = useCallback(() => {
    analysisCtl.current?.abort();
    // Only the expired journey is dropped; this browser's other journeys stay listed.
    const others = service.forgetCurrent ? service.forgetCurrent() : (service.reset(), 0);
    setSnapshot(null);
    setDocStates({});
    setDialog(null);
    setAnalysisPhase(null);
    history.replaceState(null, '', location.pathname + location.search);
    setView('landing');
    say({
      kind: 'note', tone: 'info', title: '這份服務旅程已失效',
      body: others ? `${JOURNEY_EXPIRED_MESSAGE}你的其他 ${others} 件事仍保留，可以從下方繼續處理。` : `${JOURNEY_EXPIRED_MESSAGE}描述你的情況，就能建立新的服務旅程。`,
    });
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
      // Any other failure keeps the stored journey: say so instead of opening on an empty chat.
      else say({ kind: 'note', tone: 'error', title: '暫時無法讀回你的服務旅程', body: '請確認網路連線後重新整理頁面；旅程會在建立後 1 小時內保留。也可以直接重新描述你的情況。' });
      setResuming(false);
    });
    return () => ctl.abort();
  }, [service, expire]);

  // The journey list is read from the server when the shown journey changes (GET only, no AI call);
  // the shown journey's own entry follows the snapshot, which is the server's latest answer.
  const refreshJourneys = useCallback(() => {
    if (!service.listJourneys) return undefined;
    const ctl = new AbortController();
    service.listJourneys({ signal: ctl.signal }).then(setJourneys).catch(() => { /* keep the last list */ });
    return () => ctl.abort();
  }, [service]);
  const shownId = snapshot?.journey.id ?? null;
  useEffect(() => refreshJourneys(), [refreshJourneys, shownId, resuming]);
  // Earlier journeys are offered in the chat when none is shown, or when there are several.
  const journeyList = useMemo(() => journeys.map(item => (snapshot && item.id === snapshot.journey.id
    ? { ...item, current: true, unavailable: false, ...journeySummary(snapshot.journey) }
    : { ...item, current: false })), [journeys, snapshot]);

  /** Run a journey action; server failures become a toast, an expired journey restarts. */
  async function attempt(run) {
    try { return await run(); }
    catch (error) {
      if (error?.code === 'JOURNEY_NOT_FOUND') expire();
      else if (error?.code === 'JOURNEY_STALE') await reloadStale();
      else notify(error?.message && error?.code ? error.message : '目前暫時無法處理，請稍後再試。');
      return null;
    }
  }

  /** Another change won (JOURNEY_STALE): show the current journey and let the user decide; never re-send. */
  async function reloadStale() {
    try {
      setSnapshot(await service.refresh());
      notify('案件剛剛有其他更新，已重新讀取最新狀態；請確認後再操作一次。');
    } catch (error) {
      if (error?.code === 'JOURNEY_NOT_FOUND') expire();
      else notify('案件剛剛有其他更新，但目前無法重新讀取；請稍後重新整理頁面。');
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

  /** Append a chat message (NAVI by default). */
  function say(message) {
    const id = `m${++messageId.current}`;
    setMessages(list => [...list, { role: 'navi', ...message, id }]);
  }

  /**
   * One chat turn. `label` is what the user's bubble shows (an option button's label); `text` is what is
   * analysed — for follow-up options it carries the earlier context too. The server still decides.
   */
  /**
   * `picked`: a task the user chose from several in one message — its understanding is reused (no second
   * AI call). The tasks not handled yet stay in openTasks, offered under the latest reply.
   */
  async function send(text, label = text, picked = null) {
    analysisCtl.current?.abort();
    const ctl = new AbortController();
    analysisCtl.current = ctl;
    say({ role: 'user', text: label });
    const reply = next => { setAnalysisPhase(null); say(next); };
    // Official-site answers are searched locally; refused questions never reach the AI.
    const knowledge = searchKnowledge(text);
    if (knowledge.status === 'out_of_scope') { reply(guardReply(knowledge.hotline)); return; }
    const answered = knowledge.status === 'answered';
    const answers = notice => ({ kind: 'answers', result: knowledge, notice, followUp: followUpForAnswers(knowledge, text) });
    setAnalysisPhase(0);
    const step = reduced ? 0 : 520;
    const startedAt = performance.now();
    try {
      // 住院醫療理賠 opens the full journey; other services show the official answers when there are any.
      const openJourney = kind => service.productEnabled || kind === 'hospital' || !answered;
      let understanding = picked?.understanding ?? null;
      if(service.productEnabled){const info=await service.productInfo();if(info.session.authRequired&&!info.session.authenticated){setProductDialog('data');reply({kind:'note',tone:'info',title:'請先登入',body:'登入後才能保存並繼續處理你的服務需求。',retry:{text,label}});return;}if(!info.session.consentAccepted){setProductDialog('consent');reply({kind:'note',tone:'info',title:'請先確認資料處理說明',body:'確認後，請再送出這項需求；資料不會在你同意前交給 AI。',retry:{text,label}});return;}}
      if (!picked && service.capabilities.tasks) {
        // Several independent requests: list them and let the user choose one; nothing opens on its own.
        const split = await service.understandTasks(text, { signal: ctl.signal });
        if(split?.productReply&&!split.productReply.understanding){const p=split.productReply;reply(p.evidence.status==='answered'?{kind:'answers',result:service.knowledgeResult(p),notice:p.errorCode?'AI 暫時無法回應，以下為已核對來源的資料。':undefined}:{kind:'note',tone:'info',title:'下一步',body:p.answer});return;}
        if(split?.productReply?.answer)say({kind:'note',tone:'info',title:'依據資料整理',body:split.productReply.answer});
        if (split && split.tasks.length > 1) {
          await wait(step + 160 - (performance.now() - startedAt), ctl.signal);
          setOpenTasks({ split, tasks: split.tasks });
          reply({ kind: 'tasks', split });
          return;
        }
        if (split) understanding = understandingOfTask(split, split.tasks[0]);
      }
      const result = await service.analyze(text, { signal: ctl.signal, openJourney, understanding });
      await wait(step + 160 - (performance.now() - startedAt), ctl.signal);
      setAnalysisPhase(1);
      await wait(step, ctl.signal);
      if (!result.snapshot) { reply(answered ? answers() : replyFor(result.understanding, text, knowledge.hotline)); return; }
      setAnalysisPhase(2);
      await wait(step, ctl.signal);
      setDocStates({});
      setTab('journey');
      setSnapshot(result.snapshot);
      // The journey opens as a card in the chat; the user enters the workspace from there.
      reply({ kind: 'journey', journeyId: result.snapshot.journey.id });
    } catch (error) {
      if (ctl.signal.aborted) return;
      // The official answers do not depend on the AI service, so they still help when it is down.
      // The analysis can still be retried (manually: a timeout is never re-sent on its own).
      if (answered) {
        const notice = error?.code === 'INTENT_RECEIPT_REQUIRED'
          ? `${errorCopy.INTENT_RECEIPT_REQUIRED[0]}，以下先列出官網資料中的相關說明；按「重新分析」可再建立服務旅程。`
          : 'AI 分析暫時無法使用，以下是官網資料中的相關說明。';
        reply({ ...answers(notice), retry: { text, label } });
        return;
      }
      const [title, body] = errorCopy[error?.code] ?? errorCopy.DEFAULT;
      reply({ kind: 'note', tone: 'error', title, body, retry: { text, label } });
    }
  }

  /** Handle one task of several; the others stay listed for later. */
  function pickTask(split, task) {
    const understanding = understandingOfTask(split, task);
    setOpenTasks(current => {
      const tasks = current?.tasks.filter(other => other.id !== task.id) ?? [];
      return tasks.length ? { split: current.split, tasks } : null;
    });
    send(task.input, task.input, understanding ? { understanding, split } : null);
  }
  /** From the workspace: back to the chat, where the chosen request is handled. */
  function pickOpenTask(split, task) {
    goLanding();
    pickTask(split, task);
  }

  /** Show another journey of this browser, read again from the server. */
  async function switchJourney(id) {
    if (id === snapshotRef.current?.journey.id) { goWorkspace(); return; }
    try {
      const next = await service.switchJourney(id);
      analysisCtl.current?.abort();
      setSnapshot(next);
      setDocStates({});
      setExplanation(null);
      setDialog(null);
      setTab('journey');
      if (view !== 'workspace') goWorkspace();
      notify(`已切換到「${next.journey.title}」。`);
    } catch (error) {
      if (error?.code === 'JOURNEY_NOT_FOUND') notify('這件事的服務旅程已失效（超過 1 小時或服務重新啟動），已從清單移除；其他事情不受影響。');
      else notify(error?.message && error?.code ? error.message : '目前無法讀取這件事，請確認網路後再試一次。');
      refreshJourneys();
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
      notify(added?.status === 'needs_review' ? `${documentSpecs[type].title}有欄位待人工確認：可重新上傳較清楚的文件，或轉由專員協助確認。` : `${documentSpecs[type].title}欄位檢查通過，準備度已更新（尚未驗證文件真偽）。`);
    } catch (error) {
      if (error?.code === 'JOURNEY_NOT_FOUND') { expire(); return; }
      if (error?.code === 'JOURNEY_STALE') { setDocStates(s => ({ ...s, [type]: { status: 'idle' } })); await reloadStale(); return; }
      // Server messages (e.g. 文件類型與目前服務需求不同, JOURNEY_BUSY) are written for the user.
      const message = error?.code && error.message ? error.message : null;
      setDocStates(s => ({ ...s, [type]: { status: 'failed', message } }));
      // The document card may be off screen (the upload started from 下一步), so say it where the user is too.
      notify(`${documentSpecs[type].title}沒有完成辨識，準備完成度未改變。${message ?? '請稍後再試，或改為先提供資訊。'}`);
    } finally {
      setFailNext(false);
    }
  }

  /** Take the user to the step's page on the insurer site (embedded: host navigates; standalone: new tab). */
  const openOnSite = host.connected
    ? destination => host.send(naviMessage('navi:navigate', { destination }))
    : !embedded && mockSiteOrigin
      ? destination => {
        const url = new URL(destination.path, mockSiteOrigin);
        if (destination.anchor) url.searchParams.set('focus', destination.anchor);
        window.open(url, '_blank', 'noopener');
      }
      : null;

  // Every「帶我去」whose place is a knowledge entry starts a step-by-step guide when that entry has a
  // multi-step plan (shared/knowledge/navigationPlan.js); anything else is a single navigation as before.
  const guideRequest = useRef(0);
  const navigate = openOnSite ? async destination => {
    // Go right away (a new tab must open inside the click); step 1 of the plan is this same place.
    openOnSite(destination);
    const request = ++guideRequest.current;
    const entry = knowledgeEntries.find(e => e.destination.path === destination.path && e.destination.anchor === destination.anchor);
    let plan = null;
    if (entry) {
      // Only a slow plan request shows「正在準備導覽…」; the local /demo plan is instant and never flashes it.
      const hint = setTimeout(() => { if (request === guideRequest.current) setGuidePending(true); }, 120);
      try { const result = await service.navigationPlan(entry.id); plan = result.status === 'answered' ? result.plan : null; }
      catch (error) {
        plan = null;
        // The release's site has no such place: say so instead of implying NAVI took the user there.
        if (error?.code === 'NAVIGATION_TARGET_UNAVAILABLE') notify('官網上暫時找不到這個位置。可以先看答案下方的官網原文，或開啟官網原頁。');
      }
      clearTimeout(hint);
    }
    if (request !== guideRequest.current) return; // a newer request replaced this one
    setGuidePending(false);
    setGuide(plan && plan.steps.length > 1 && plan.steps[0].sourceId === entry.id ? { plan, index: 0 } : null);
  } : null;
  const guideStep = index => {
    setGuide(current => (current ? { ...current, index } : current));
    // Embedded: the host page follows each step. Standalone: 在官網開啟 opens a step on request (no tab per click).
    if (host.connected) openOnSite(guide.plan.steps[index].destination);
  };
  const endGuide = completed => {
    guideRequest.current += 1;
    setGuidePending(false);
    setGuide(null);
    if (completed) notify('導覽完成。需要時可以再按「帶我去」重新開始。');
  };

  const actions = {
    // Where uploaded files go differs by mode; say so plainly next to the upload cards.
    documentNotice: service.capabilities.manualEntry
      ? '文件辨識使用示範資料；你的檔案不會被讀取或上傳。'
      : '文件會傳送到 NAVI 服務辨識，不會保存檔案本身；這是示範原型，請勿上傳真實病歷或銀行資料。',
    footerNotice: service.capabilities.manualEntry
      ? '進度只保留在這個分頁；文件不會被上傳。'
      : '案件由 NAVI 服務保存，1 小時後失效；這是示範原型，請勿輸入真實病歷或銀行資料。',
    manualVerifies: service.capabilities.manualEntry,
    upload,
    // /demo fills in local sample data; formal mode sends the synthetic PDF for real AI recognition.
    sample: service.capabilities.samples ? type => upload(type, { sample: true }) : null,
    sampleByAi: service.capabilities.samples === 'ai',
    navigate,
    async remove(type) {
      const next = await attempt(() => service.removeDocument(type));
      if (!next) return;
      setSnapshot(next);
      setDocStates(s => ({ ...s, [type]: { status: 'idle' } }));
      notify('文件已移除，準備完成度已更新。');
    },
    // /demo: manual contents count as confirmed demo data. Formal mode: the server stores them as
    // 待確認 information that adds no readiness; only a verified upload changes the score.
    async manual(type, fields) {
      if (!fields) { setDocStates(s => ({ ...s, [type]: { status: 'manual' } })); return; }
      const next = await attempt(() => service.submitManual(type, fields));
      if (!next) return;
      setSnapshot(next);
      setDocStates(s => ({ ...s, [type]: { status: 'idle' } }));
      notify(service.capabilities.manualEntry
        ? `${documentSpecs[type].title}內容已確認，準備完成度已更新。`
        : `已記下${documentSpecs[type].title}資訊（待確認），不會計入準備完成度；請上傳文件或由專員確認。`);
    },
    async removeManual(type) {
      const next = await attempt(() => service.removeManual(type));
      if (!next) return;
      setSnapshot(next);
      notify('已移除待確認資訊。');
    },
    resetDocument(type) { setDocStates(s => ({ ...s, [type]: { status: 'idle' } })); },
    // NAVI understood the wrong service: the user says what it really is (formal mode; the server re-reads it).
    correct: service.capabilities.correction ? () => setDialog('correct') : null,
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
          // Any other missing detail (e.g. after a correction NAVI could not place): describe the need again.
          else if (action.target !== 'inpatient_info' && service.capabilities.correction) setDialog('correct');
          else { goLanding(); notify('請在聊天室多說明一點你想處理的事情，NAVI 會重新理解。'); }
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
    setOpenTasks(null);
    setJourneys([]);
    setMessages(welcome());
    setDocStates({});
    setDialog(null);
    setGuide(null);
    goLanding();
    notify('已重新開始，可以描述新的情況。');
  }

  // The step-by-step guide: in the chat it sits in the bottom dock above the input (never over it);
  // on the workspace it floats at the bottom of the screen.
  const guideLayer = (
    <AnimatePresence>
      {guidePending && !guide && (
        <motion.p key="guide-preparing" className="guide-preparing" role="status"
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: transition.enter }} exit={{ opacity: 0, transition: transition.exit }}>
          <span className="dots" aria-hidden="true"><i /><i /><i /></span>正在準備導覽…
        </motion.p>
      )}
      {guide && (
        <GuideCard key="guide" guide={guide} embedded={host.connected}
          onStep={guideStep} onOpen={step => openOnSite(step.destination)} onEnd={endGuide} />
      )}
    </AnimatePresence>
  );

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">跳至主要內容</a>
        {embedded ? (
          <EmbedHeader
            mode={mode} view={view} hasJourney={Boolean(snapshot)} busy={analysisPhase !== null || Boolean(busyType)}
            onHome={goLanding} onResume={goWorkspace} onReset={reset} onData={productReady?()=>setProductDialog('data'):null}
            onClose={host.connected ? () => host.send(naviMessage('navi:close')) : null}
          />
        ) : (
          <AppHeader
            mode={mode} view={view} hasJourney={Boolean(snapshot)} busy={analysisPhase !== null || Boolean(busyType)}
            onHome={goLanding} onResume={goWorkspace} onReset={reset} onData={productReady?()=>setProductDialog('data'):null}
            reduceMotion={reduceMotion} onReduceMotion={setReduceMotion}
            failNext={failNext} onFailNext={value => { setFailNext(value); service.setFailNextDocument(value); }}
          />
        )}
        {recovery&&<AccountRecoveryDialog service={service} {...recovery} onClose={()=>{history.replaceState(null,'',location.pathname);setRecovery(null);setProductDialog('data');}}/>}
        {productDialog&&<ProductDataDialog service={service} consentOnly={productDialog==='consent'} onClose={()=>setProductDialog(null)} onJourney={next=>{setSnapshot(next);goWorkspace();}} onDeleted={reset}/>}
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
                key="workspace" snapshot={snapshot} explanation={explanation} docStates={docStates} busy={busyType}
                tab={tab} onTab={setTab} assistantOpen={assistantOpen} onAssistantOpen={setAssistantOpen}
                actions={actions} registerInput={(type, el) => { fileInputs.current[type] = el; }}
                preparation={snapshot.journey.workflowId?<ServiceWorkflow snapshot={snapshot} service={service} onUpdate={setSnapshot}/>:null}
                taskBar={<TaskBar journeys={journeyList} openTasks={openTasks} busy={analysisPhase !== null || Boolean(busyType)} onSwitch={switchJourney} onPickOpen={pickOpenTask} />}
              />
            ) : (
              <Landing
                key="landing" mode={mode} messages={messages} analysisPhase={analysisPhase} snapshot={snapshot} openTasks={openTasks}
                journeysSlot={journeyList.length > (snapshot ? 1 : 0) ? <TaskBar variant="chat" journeys={journeyList} busy={analysisPhase !== null} onSwitch={switchJourney} /> : null}
                onSwitchJourney={service.switchJourney ? switchJourney : null}
                dock={guideLayer} onSend={send} onPickTask={pickTask} onNavigate={navigate} onOpenWorkspace={goWorkspace}
                onHotline={() => say({ kind: 'note', tone: 'info', title: '真人客服', body: `請撥免付費服務專線 ${searchKnowledge('').hotline}，專人會協助你。NAVI 不會代為聯絡或送出資料。` })}
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
                setSnapshot(next); setDialog(null); notify('資料已確認：已完成 NAVI 初步資料準備（100%），仍需依正式規定確認與送件。');
              }}
              onProceed={() => setDialog('proceed')} />
          )}
          {snapshot && dialog === 'proceed' && (
            <ProceedDialog key="proceed" snapshot={snapshot} onClose={closeDialog} onNavigate={navigate}
              onDone={() => { setDialog(null); notify('服務導引已完成，案件資料保留在這個分頁。'); }} />
          )}
          {snapshot && dialog === 'handoff' && (
            <HandoffDialog key="handoff" snapshot={snapshot} service={service} onClose={closeDialog} onConfirmed={() => setSnapshot(service.requestHandoff())} />
          )}
          {snapshot && dialog === 'correct' && (
            <CorrectionDialog key="correct" onClose={closeDialog}
              onSubmit={async text => {
                try {
                  const { snapshot: next } = await service.correctIntent(text);
                  setSnapshot(next); setDocStates({}); setDialog(null);
                  notify(next.journey.documents.length ? '已依新的描述更新需求；先前上傳的文件已保留，需要重新確認。' : '已依新的描述更新需求。');
                  return null;
                } catch (error) {
                  if (error?.code === 'JOURNEY_NOT_FOUND') { expire(); return null; }
                  return error?.code && error.message ? error.message : '目前無法修正，請稍後再試。';
                }
              }} />
          )}
          {snapshot && dialog === 'service' && (
            <ServiceDialog key="service" snapshot={snapshot} onClose={closeDialog} onHandoff={() => setDialog('handoff')} onNavigate={navigate} />
          )}
        </AnimatePresence>

        {view === 'workspace' && snapshot && guideLayer}

        <div className="toast-region" aria-live="polite">
          <AnimatePresence>{toast && <Toast key={toast.key} message={toast.message} onDismiss={dismissToast} />}</AnimatePresence>
        </div>
      </div>
    </MotionConfig>
  );
}
