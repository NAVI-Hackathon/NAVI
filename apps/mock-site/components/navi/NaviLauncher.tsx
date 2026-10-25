"use client";

/**
 * NAVI 浮動元件：右下角按鈕 → 側邊面板（手機全螢幕）以 iframe 載入 NAVI 嵌入模式。
 * 只接受來自 NEXT_PUBLIC_NAVI_EMBED_URL 同源、且來自該 iframe 的 postMessage。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  NaviMessageSchema, hostMessage, isAllowedOrigin, originOf, readMessage,
} from "../../../../shared/embed.js";

const EMBED_URL = process.env.NEXT_PUBLIC_NAVI_EMBED_URL ?? "";
const NAVI_ORIGIN = originOf(EMBED_URL);
// 現場備案：連不上正式 NAVI 時改載入同一個 NAVI 的示範模式（前端本地資料，不需要 Backend）。
const DEMO_URL = (() => {
  try { const url = new URL(EMBED_URL); url.searchParams.set("mode", "demo"); return url.toString(); } catch { return ""; }
})();
const CONNECT_TIMEOUT_MS = 8000;

export type NaviDestination = { kind: string; path: string; anchor: string | null; label: string };

export function NaviLauncher({ onNavigate }: { onNavigate?: (destination: NaviDestination) => void }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [connected, setConnected] = useState(false);
  // Phones: after NAVI takes the user to a place, the panel folds away; the button then invites them back.
  const [resume, setResume] = useState(false);
  // Connection watchdog: if NAVI has not said navi:ready within 8 s, offer retry or demo mode.
  const [attempt, setAttempt] = useState(0);
  const [demo, setDemo] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);

  const sayHello = useCallback(() => {
    if (NAVI_ORIGIN) frame.current?.contentWindow?.postMessage(hostMessage("host:hello"), NAVI_ORIGIN);
  }, []);

  useEffect(() => {
    if (!NAVI_ORIGIN) return;
    const allowedOrigins = [NAVI_ORIGIN];
    const onMessage = (event: MessageEvent) => {
      if (!isAllowedOrigin(event.origin, allowedOrigins)) return;
      const message = readMessage(event, { allowedOrigins, expectedSource: frame.current?.contentWindow ?? null, schema: NaviMessageSchema });
      if (!message) return;
      if (message.type === "navi:ready") { setConnected(true); sayHello(); }
      if (message.type === "navi:close") { setOpen(false); launcher.current?.focus(); }
      if (message.type === "navi:navigate") {
        onNavigate?.(message.destination);
        // On phones the panel covers the page; close it so the highlighted target is visible.
        if (window.matchMedia("(max-width: 639.98px)").matches) { setOpen(false); setResume(true); }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onNavigate, sayHello]);

  useEffect(() => {
    if (!mounted || connected) return;
    const timer = setTimeout(() => setTimedOut(true), CONNECT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [mounted, connected, attempt]);

  const reconnect = (useDemo: boolean) => {
    setConnected(false);
    setTimedOut(false);
    setDemo(useDemo);
    setAttempt(n => n + 1); // remounts the iframe
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!NAVI_ORIGIN) return null;

  return (
    <>
      {!open && (
        <button
          ref={launcher}
          type="button"
          data-tour-id="navi-launcher"
          aria-expanded={false}
          aria-controls="navi-panel"
          aria-label={resume ? "回到 NAVI，繼續下一步" : undefined}
          onClick={() => {
            // 錄影與展示入口：?navi=demo 直接載入示範模式（範例文件只在示範模式提供）。
            if (!mounted && DEMO_URL && new URLSearchParams(window.location.search).get("navi") === "demo") setDemo(true);
            setMounted(true); setOpen(true); setResume(false);
          }}
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-full border py-2.5 pl-2.5 pr-5 text-sm font-medium shadow-[0_12px_40px_rgba(0,0,0,0.28)] transition-transform hover:-translate-y-0.5 ${resume ? "navi-resume border-[#97c9b3]/60 bg-[#0a0b0d] text-[#eeefe9]" : "border-white/10 bg-[#0a0b0d] text-[#eeefe9]"}`}
        >
          <span aria-hidden className={`grid size-8 place-items-center rounded-full ${resume ? "bg-[#97c9b3]" : "bg-[#eeefe9]"}`}>
            {resume
              ? <svg viewBox="0 0 24 24" className="size-4"><path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="#0a0b0d" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              : <svg viewBox="0 0 40 40" className="size-5"><path d="M11 29V20h9v-9h9m-5 0h5v5" fill="none" stroke="#0a0b0d" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </span>
          <span className="flex flex-col items-start leading-tight">
            <span className="tracking-[0.12em]">{resume ? "回到 NAVI" : "NAVI"}</span>
            <span className="text-[11px] font-normal text-[#97c9b3]">{resume ? "繼續下一步" : "告訴我發生了什麼"}</span>
          </span>
        </button>
      )}

      {mounted && (
        <section
          id="navi-panel"
          role="dialog"
          aria-label="NAVI 服務導航助手"
          hidden={!open}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#0a0b0d] shadow-[0_20px_70px_rgba(0,0,0,0.35)] sm:inset-auto sm:bottom-4 sm:right-4 sm:top-4 sm:w-[420px] sm:rounded-2xl sm:border sm:border-white/10"
        >
          {!connected && !timedOut && (
            <div role="status" className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-xs text-[#90989d]">
              <span>正在連線 NAVI…</span>
              <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-[#eeefe9] hover:bg-white/10" aria-label="關閉 NAVI">關閉</button>
            </div>
          )}
          {!connected && timedOut && (
            <div role="alert" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#0a0b0d] px-8 text-center">
              <p className="text-base font-medium text-[#eeefe9]">NAVI 暫時無法連線</p>
              <p className="text-xs leading-relaxed text-[#90989d]">
                {demo ? "示範模式也無法載入，請確認 NAVI 網站是否啟動。" : "可以再試一次，或改用示範模式（使用示範資料，不需要連線服務）。"}
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={() => reconnect(demo)} className="rounded-lg bg-[#eeefe9] px-4 py-2 text-sm font-medium text-[#16191b] hover:bg-white">重試</button>
                {!demo && DEMO_URL && (
                  <button type="button" onClick={() => reconnect(true)} className="rounded-lg border border-white/20 px-4 py-2 text-sm text-[#eeefe9] hover:bg-white/10">改用示範模式</button>
                )}
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm text-[#90989d] hover:text-[#eeefe9]">關閉</button>
              </div>
            </div>
          )}
          <iframe
            key={attempt}
            ref={frame}
            src={demo ? DEMO_URL : EMBED_URL}
            title="NAVI 服務導航助手"
            onLoad={sayHello}
            className="w-full flex-1 border-0 bg-[#0a0b0d]"
          />
        </section>
      )}
    </>
  );
}
