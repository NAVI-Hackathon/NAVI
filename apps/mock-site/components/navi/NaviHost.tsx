"use client";

/**
 * Mock-site side of NAVI navigation: go to the page, switch to the right tab, scroll and
 * briefly spotlight the target (data-tour-id). Triggered by
 * 1. navi:navigate messages from the embedded NAVI (via NaviLauncher), or
 * 2. ?focus=<data-tour-id> when standalone NAVI opens this site in a new tab.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { revealTabPanels } from "@/components/site/Tabs";
import { NaviLauncher, type NaviDestination } from "./NaviLauncher";

const ANCHOR = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIND_TIMEOUT_MS = 4000;
// The page dims briefly to draw the eye, then only the ring stays, so the page remains usable.
const DIM_MS = 1600;

type Pending = { anchor: string; label: string; id: number };
type Spot = { element: HTMLElement; label: string; id: number };

function waitForElement(selector: string, timeout: number): Promise<HTMLElement | null> {
  return new Promise(resolve => {
    const started = performance.now();
    const tick = () => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element) resolve(element);
      else if (performance.now() - started > timeout) resolve(null);
      else setTimeout(tick, 80);
    };
    tick();
  });
}

/**
 * Spotlight that stays on the target until the next NAVI step, Esc or ×.
 * Follows the element while the page scrolls; never blocks clicks (pointer-events: none).
 */
function Spotlight({ spot, onClose }: { spot: Spot; onClose: () => void }) {
  const ring = useRef<HTMLDivElement>(null);
  const [dimmed, setDimmed] = useState(true); // keyed per step, so each step starts dimmed

  useEffect(() => {
    const timer = setTimeout(() => setDimmed(false), DIM_MS);
    let frame = 0;
    const follow = () => {
      if (!spot.element.isConnected) { onClose(); return; }
      const rect = spot.element.getBoundingClientRect();
      const node = ring.current;
      if (node) {
        node.style.transform = `translate(${rect.left - 8}px, ${rect.top - 8}px)`;
        node.style.width = `${rect.width + 16}px`;
        node.style.height = `${rect.height + 16}px`;
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(timer); cancelAnimationFrame(frame); window.removeEventListener("keydown", onKey); };
  }, [spot, onClose]);

  return (
    <div ref={ring} className={`navi-spot ${dimmed ? "is-dimmed" : ""}`}>
      <span className="navi-spot-label">
        <span aria-hidden className="navi-spot-dot" />NAVI・{spot.label}
        <button type="button" onClick={onClose} aria-label="關閉 NAVI 標示">×</button>
      </span>
    </div>
  );
}

function TourController({ pending }: { pending: Pending | null }) {
  const pathname = usePathname();
  const [announcement, setAnnouncement] = useState("");
  const [spot, setSpot] = useState<Spot | null>(null);
  // A target that never appears is said out loud; the visitor is not left wondering where NAVI took them.
  const [missing, setMissing] = useState<string | null>(null);
  const done = useRef<number | null>(null);
  const close = useCallback(() => setSpot(null), []);

  useEffect(() => {
    if (!missing) return;
    const timer = setTimeout(() => setMissing(null), 6000);
    return () => clearTimeout(timer);
  }, [missing]);

  useEffect(() => {
    if (!pending || done.current === pending.id) return;
    let cancelled = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setSpot(null); // the previous step's mark goes away as soon as the next one starts
    setMissing(null);
    void (async () => {
      const target = await waitForElement(`[data-tour-id="${pending.anchor}"]`, FIND_TIMEOUT_MS);
      if (cancelled) return;
      if (!target) {
        done.current = pending.id;
        setMissing(pending.label);
        setAnnouncement(`這一頁找不到「${pending.label}」`);
        return;
      }
      done.current = pending.id;
      revealTabPanels(target);
      // Let the tab panel become visible before measuring/scrolling.
      await new Promise(resolve => setTimeout(resolve, 60));
      target.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
      setSpot({ element: target, label: pending.label, id: pending.id });
      setAnnouncement(`已帶你到「${pending.label}」`);
    })();
    return () => { cancelled = true; };
  }, [pending, pathname]);

  return (
    <>
      {spot && <Spotlight key={spot.id} spot={spot} onClose={close} />}
      {missing && (
        <div className="fixed left-1/2 top-24 z-[60] w-[min(92vw,520px)] -translate-x-1/2 rounded-xl border border-[#97c9b3]/40 bg-[#0a0b0d] px-5 py-4 text-sm leading-relaxed text-[#eeefe9] shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
          <p className="font-medium">NAVI 在這一頁找不到「{missing}」</p>
          <p className="mt-1 text-xs text-[#b9c7c0]">請在這一頁查看相關內容，或回到 NAVI 改選其他方式、轉由真人客服協助。</p>
          <button type="button" onClick={() => setMissing(null)} className="absolute right-3 top-3 grid size-9 place-items-center rounded-full text-[#eeefe9] hover:bg-white/10" aria-label="關閉提示">×</button>
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </>
  );
}

/** Reads ?focus= once per navigation (standalone NAVI opens links in a new tab). */
function FocusParam({ onFocus }: { onFocus: (anchor: string) => void }) {
  const params = useSearchParams();
  const focus = params.get("focus");
  useEffect(() => { if (focus && ANCHOR.test(focus)) onFocus(focus); }, [focus, onFocus]);
  return null;
}

export function NaviHost() {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState<Pending | null>(null);
  const counter = useRef(0);

  const onNavigate = useCallback((destination: NaviDestination) => {
    const id = ++counter.current;
    if (destination.anchor) setPending({ anchor: destination.anchor, label: destination.label, id });
    if (destination.path !== pathname) router.push(destination.path, { scroll: !destination.anchor });
  }, [pathname, router]);

  const onFocus = useCallback((anchor: string) => {
    setPending({ anchor, label: "NAVI 建議的位置", id: ++counter.current });
  }, []);

  return (
    <>
      <Suspense fallback={null}><FocusParam onFocus={onFocus} /></Suspense>
      <TourController pending={pending} />
      <NaviLauncher onNavigate={onNavigate} />
    </>
  );
}
