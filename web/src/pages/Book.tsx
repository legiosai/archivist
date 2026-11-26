import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { EventBus, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import { AuthError, api, saveProgress, unitPath, useQuery, type WorkDetail } from "../api.ts";
import { Icon } from "../icons.tsx";
import { openPdf, quietL10n, viewerKit, type PDFDocumentProxy } from "../pdf.ts";
import { AskPanel } from "./Ask.tsx";

// pdf.js constants, spelled out so the menus can be built before the library loads.
const SCROLL = { vertical: 0, horizontal: 1, wrapped: 2, page: 3 } as const;
const SPREAD = { none: 0, odd: 1, even: 2 } as const;
const FOUND = 0, NOT_FOUND = 1, WRAPPED = 2;

type Theme = "original" | "sepia" | "dark" | "night";
type Side = "" | "thumbs" | "outline";
interface Prefs { scale: string; scroll: number; spread: number; theme: Theme; side: Side }
const DEFAULTS: Prefs = { scale: "auto", scroll: SCROLL.vertical, spread: SPREAD.none, theme: "original", side: "" };

const ZOOMS: [string, string][] = [
  ["auto", "Automático"], ["page-fit", "Ajustar a la página"], ["page-width", "Ajustar al ancho"], ["page-actual", "Tamaño real"],
  ["0.5", "50 %"], ["0.75", "75 %"], ["1", "100 %"], ["1.25", "125 %"], ["1.5", "150 %"], ["2", "200 %"], ["3", "300 %"], ["4", "400 %"],
];
const THEMES: [Theme, string][] = [["original", "Original"], ["sepia", "Sepia"], ["dark", "Oscuro"], ["night", "Noche"]];
const THUMB_W = 132;

interface OutlineNode { title: string; dest: string | unknown[] | null; url: string | null; items: OutlineNode[] }
interface Kit { viewer: PDFViewer; bus: EventBus; link: PDFLinkService; find: PDFFindController; doc: PDFDocumentProxy }

function stored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

const isPreset = (v: string) => /^(auto|page-fit|page-width|page-actual)$/.test(v);

// The viewer's own line icons (24×24, stroke = currentColor), next to the app's set in icons.tsx.
const glyphs: Record<string, ReactNode> = {
  sidebar: <><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M9 4.5v15" /></>,
  minus: <path d="M5 12h14" />,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  rotate: <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></>,
  rotateLeft: <><path d="M4 12a8 8 0 1 0 2.6-5.9" /><path d="M4 4v5h5" /></>,
  download: <><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M4 19h16" /></>,
  expand: <><path d="M4 9V4h5" /><path d="M20 9V4h-5" /><path d="M4 15v5h5" /><path d="M20 15v5h-5" /></>,
  shrink: <><path d="M9 4v5H4" /><path d="M15 4v5h5" /><path d="M9 20v-5H4" /><path d="M15 20v-5h5" /></>,
  present: <><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M12 16v4" /><path d="M8 20h8" /></>,
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  fit: <><path d="M4 12h16" /><path d="m8 8-4 4 4 4" /><path d="m16 8 4 4-4 4" /></>,
};

function Glyph({ name }: { name: keyof typeof glyphs }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true">{glyphs[name]}</svg>
  );
}

/**
 * A book in PDF, read the way a browser's PDF viewer reads it: the real pages drawn sharp at any
 * zoom, text that can be selected and searched, the book's own index, page thumbnails, one or two
 * pages at a time, four paper colours, and the panel to ask about the page docked on the right.
 * The page in view is saved as you go.
 */
export default function Book({ id, unitKey, onAuth }: { id: string; unitKey: string; onAuth: () => void }) {
  const base = unitPath(id, unitKey);
  const startAt = Number(useQuery("p") ?? 0);
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(0);
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [scale, setScale] = useState({ value: "auto", pct: 100 });
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...DEFAULTS, ...stored<Partial<Prefs>>(`book:${id}`, {}) }));
  const [menu, setMenu] = useState(false);
  const [canAsk, setCanAsk] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askWidth, setAskWidth] = useState(() => stored("ask:width", 420));
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [found, setFound] = useState<{ state: number; current: number; total: number } | null>(null);
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [quote, setQuote] = useState<{ text: string; n: number } | null>(null);
  const [full, setFull] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 820px)").matches);

  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const viewerDiv = useRef<HTMLDivElement>(null);
  const findBox = useRef<HTMLInputElement>(null);
  const kit = useRef<Kit | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const where = useRef({ page: 0, count: 0 });
  where.current = { page, count };
  const beforePresenting = useRef<Pick<Prefs, "scale" | "scroll" | "spread"> | null>(null);
  const askWidthRef = useRef(askWidth);
  askWidthRef.current = askWidth;

  // Open the book: the work, whether there is a model to ask, then the PDF itself.
  useEffect(() => {
    let dead = false;
    let task: ReturnType<typeof openPdf> | null = null;
    setReady(false);
    setError("");
    (async () => {
      try {
        const [w, meta] = await Promise.all([
          api<WorkDetail>(`/api/v1/works/${id}`),
          api<{ count: number; assistant?: boolean }>(`${base}/pages`),
        ]);
        if (dead) return;
        setWork(w);
        setCanAsk(Boolean(meta.assistant));
        setAsking(meta.assistant ? stored("ask:open", !window.matchMedia("(max-width: 820px)").matches) : false);
        const unit = w.unitList.find((u) => u.key === unitKey);
        const saved = unit?.progress && !unit.progress.finished ? unit.progress.position : 1;
        const start = Math.max(1, startAt || saved);

        const lib = await viewerKit();
        if (dead || !scroller.current || !viewerDiv.current) return;
        const bus = new lib.EventBus();
        const link = new lib.PDFLinkService({ eventBus: bus, externalLinkTarget: lib.LinkTarget.BLANK, externalLinkRel: "noopener noreferrer nofollow" });
        const find = new lib.PDFFindController({ eventBus: bus, linkService: link });
        const viewer = new lib.PDFViewer({
          container: scroller.current, viewer: viewerDiv.current, eventBus: bus, linkService: link, findController: find,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          l10n: quietL10n as any,
        });
        link.setViewer(viewer);

        bus.on("pagesinit", () => {
          const p = prefsRef.current;
          viewer.scrollMode = p.scroll;
          viewer.spreadMode = p.spread;
          viewer.currentScaleValue = p.scale;
          if (start > 1) viewer.currentPageNumber = Math.min(start, viewer.pagesCount);
          setPage(viewer.currentPageNumber);
          setReady(true);
          scroller.current?.focus({ preventScroll: true });
        });
        bus.on("pagechanging", (e: { pageNumber: number }) => setPage(e.pageNumber));
        bus.on("scalechanging", (e: { scale: number; presetValue?: string }) =>
          setScale({ value: e.presetValue ?? String(Math.round(e.scale * 1000) / 1000), pct: Math.round(e.scale * 100) }));
        bus.on("updatefindmatchescount", (e: { matchesCount: { current: number; total: number } }) =>
          setFound((f) => ({ state: f?.state ?? FOUND, current: e.matchesCount.current, total: e.matchesCount.total })));
        bus.on("updatefindcontrolstate", (e: { state: number; matchesCount?: { current: number; total: number } }) =>
          setFound({ state: e.state, current: e.matchesCount?.current ?? 0, total: e.matchesCount?.total ?? 0 }));

        task = openPdf(`${base}/file`);
        task.onProgress = ({ loaded: l, total }: { loaded: number; total: number }) => total && setLoaded(Math.min(1, l / total));
        const doc = await task.promise;
        if (dead) return;   // the cleanup below destroys the task, and the document with it
        kit.current = { viewer, bus, link, find, doc };
        viewer.setDocument(doc);
        link.setDocument(doc, null);
        setCount(doc.numPages);
        doc.getOutline().then((o) => !dead && setOutline((o ?? []) as OutlineNode[])).catch(() => setOutline([]));
      } catch (e) {
        if (dead) return;
        if (e instanceof AuthError) onAuth();
        else setError(String((e as Error).message || e));
      }
    })();
    return () => {
      dead = true;
      const k = kit.current;
      kit.current = null;
      const { page: p, count: c } = where.current;
      if (p && c) void saveProgress(id, unitKey, p, c, true);
      k?.viewer.setDocument(null as unknown as PDFDocumentProxy);
      void task?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, unitKey, base, onAuth]);

  // Save the page in view, a moment after it settles.
  useEffect(() => {
    if (!ready || !page || !count) return;
    const t = setTimeout(() => void saveProgress(id, unitKey, page, count), 800);
    return () => clearTimeout(t);
  }, [page, count, ready, id, unitKey]);

  // Remember how this book is read: the zoom once it settles, the rest as it changes.
  useEffect(() => {
    if (!ready || presenting) return;
    const t = setTimeout(() => setPrefs((p) => (p.scale === scale.value ? p : { ...p, scale: scale.value })), 500);
    return () => clearTimeout(t);
  }, [scale.value, ready, presenting]);
  useEffect(() => { if (!presenting) store(`book:${id}`, prefs); }, [prefs, id, presenting]);
  useEffect(() => {
    const v = kit.current?.viewer;
    if (!v || !ready) return;
    if (v.scrollMode !== prefs.scroll) v.scrollMode = prefs.scroll;
    if (v.spreadMode !== prefs.spread) v.spreadMode = prefs.spread;
  }, [prefs.scroll, prefs.spread, ready]);

  // A fitted zoom follows the space it has: window, index or panel opening or closing.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const v = kit.current?.viewer;
      if (!v?.pagesCount) return;
      if (isPreset(v.currentScaleValue)) v.currentScaleValue = v.currentScaleValue;
      else v.update();
    });
    ro.observe(el);
    const mq = window.matchMedia("(max-width: 820px)");
    const onMq = () => setNarrow(mq.matches);
    mq.addEventListener("change", onMq);
    return () => { ro.disconnect(); mq.removeEventListener("change", onMq); };
  }, []);

  // Zoom the way a PDF viewer does: Ctrl/⌘ + wheel, a trackpad pinch, two fingers on a screen.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const zoomBy = (factor: number, x: number, y: number) => {
      if (!Number.isFinite(factor) || factor === 1) return;
      kit.current?.viewer.updateScale({ drawingDelay: 250, scaleFactor: factor, origin: [x, y] });
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        // A mouse wheel moves in big, round steps; a trackpad in many small ones.
        const factor = Math.abs(delta) >= 50 && Number.isInteger(delta) ? (delta < 0 ? 1.1 : 1 / 1.1) : Math.exp(-delta / 100);
        zoomBy(factor, e.clientX, e.clientY);
      }
    };
    let gesture = 1;
    const onGestureStart = (e: Event) => { e.preventDefault(); gesture = 1; };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      zoomBy(g.scale / gesture, g.clientX, g.clientY);
      gesture = g.scale;
    };
    let pinch: number | null = null;
    const span = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const onTouchStart = (e: TouchEvent) => { pinch = e.touches.length === 2 ? span(e.touches) : null; };
    const onTouchMove = (e: TouchEvent) => {
      if (pinch === null || e.touches.length !== 2) return;
      e.preventDefault();
      const d = span(e.touches);
      zoomBy(d / pinch, (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2, (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2);
      pinch = d;
    };
    const onTouchEnd = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null; };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  // Select words on the page and a button offers to ask about them.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !canAsk) return;
    const check = () => {
      const s = window.getSelection();
      const text = s?.toString().replace(/\s+/g, " ").trim() ?? "";
      if (!s || !s.rangeCount || text.length < 2 || !el.contains(s.anchorNode)) { setSelection(null); return; }
      const r = s.getRangeAt(0).getBoundingClientRect();
      setSelection({ text: text.slice(0, 1200), x: r.left + r.width / 2, y: r.top });
    };
    const later = () => setTimeout(check, 0);
    const clear = () => setSelection(null);
    el.addEventListener("mouseup", later);
    el.addEventListener("touchend", later);
    el.addEventListener("keyup", later);
    el.addEventListener("scroll", clear, { passive: true });
    return () => {
      el.removeEventListener("mouseup", later);
      el.removeEventListener("touchend", later);
      el.removeEventListener("keyup", later);
      el.removeEventListener("scroll", clear);
    };
  }, [canAsk, ready]);

  // Search: as you type, Enter for the next match, Shift+Enter for the one before.
  const runFind = useCallback((type: "" | "again", previous = false) => {
    kit.current?.bus.dispatch("find", {
      source: null, type, query, caseSensitive: matchCase, entireWord: false, highlightAll: true,
      findPrevious: previous, matchDiacritics: false,
    });
  }, [query, matchCase]);
  useEffect(() => {
    if (!finding || !ready) return;
    const t = setTimeout(() => runFind(""), 200);
    return () => clearTimeout(t);
  }, [query, matchCase, finding, ready, runFind]);
  const openFind = useCallback(() => {
    setFinding(true);
    setTimeout(() => findBox.current?.select(), 0);
  }, []);
  const closeFind = useCallback(() => {
    setFinding(false);
    setFound(null);
    kit.current?.bus.dispatch("findbarclose", { source: null });
    scroller.current?.focus({ preventScroll: true });
  }, []);

  const goTo = useCallback((n: number) => {
    const v = kit.current?.viewer;
    if (!v) return;
    v.currentPageNumber = Math.max(1, Math.min(v.pagesCount, n));
  }, []);
  const zoom = useCallback((value: string) => { const v = kit.current?.viewer; if (v) v.currentScaleValue = value; }, []);
  const rotate = useCallback((by: number) => { const v = kit.current?.viewer; if (v) v.pagesRotation = (v.pagesRotation + by + 360) % 360; }, []);
  const setPref = useCallback(<K extends keyof Prefs>(k: K, value: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: value })), []);
  const toggleSide = useCallback((side: Side) => setPrefs((p) => ({ ...p, side: p.side === side ? "" : side })), []);
  const setAskingSaved = useCallback((a: boolean) => { setAsking(a); store("ask:open", a); }, []);

  // Full screen, and presenting: one page at a time that fills the screen, as before when it ends.
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen?.().catch(() => undefined);
  }, []);
  const present = useCallback(() => {
    const v = kit.current?.viewer;
    if (!v) return;
    beforePresenting.current = { scale: v.currentScaleValue, scroll: prefsRef.current.scroll, spread: prefsRef.current.spread };
    setPresenting(true);
    setMenu(false);
    setPrefs((p) => ({ ...p, scroll: SCROLL.page, spread: SPREAD.none }));
    void root.current?.requestFullscreen?.().catch(() => undefined);
    setTimeout(() => zoom("page-fit"), 50);
  }, [zoom]);
  useEffect(() => {
    const on = () => {
      const isFull = !!document.fullscreenElement;
      setFull(isFull);
      if (!isFull && beforePresenting.current) {
        const b = beforePresenting.current;
        beforePresenting.current = null;
        setPresenting(false);
        setPrefs((p) => ({ ...p, scroll: b.scroll, spread: b.spread, scale: b.scale }));
        setTimeout(() => zoom(b.scale), 50);
      }
    };
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, [zoom]);

  // The keys of a PDF viewer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = kit.current;
      if (!k) return;
      const mod = e.ctrlKey || e.metaKey;
      const typing = e.target instanceof HTMLElement && !!e.target.closest("input, textarea, select, [contenteditable]");
      if (mod && !e.altKey && (e.key === "f" || e.key === "F")) { e.preventDefault(); openFind(); return; }
      if (mod && (e.key === "+" || e.key === "=")) { e.preventDefault(); k.viewer.increaseScale(); return; }
      if (mod && e.key === "-") { e.preventDefault(); k.viewer.decreaseScale(); return; }
      if (mod && e.key === "0") { e.preventDefault(); k.viewer.currentScaleValue = "auto"; return; }
      if (e.key === "Escape") { setSelection(null); setMenu(false); return; }
      if (typing || mod || e.altKey) return;
      const el = scroller.current!;
      const oneAtATime = k.viewer.scrollMode === SCROLL.page;
      const noSideways = el.scrollWidth <= el.clientWidth + 1;
      if (e.key === "ArrowRight" && (oneAtATime || noSideways)) { e.preventDefault(); k.viewer.nextPage(); }
      else if (e.key === "ArrowLeft" && (oneAtATime || noSideways)) { e.preventDefault(); k.viewer.previousPage(); }
      else if (oneAtATime && (e.key === "PageDown" || e.key === " " || e.key === "ArrowDown")) { e.preventDefault(); k.viewer.nextPage(); }
      else if (oneAtATime && (e.key === "PageUp" || e.key === "ArrowUp")) { e.preventDefault(); k.viewer.previousPage(); }
      else if (e.key === "Home") { e.preventDefault(); goTo(1); }
      else if (e.key === "End") { e.preventDefault(); goTo(k.viewer.pagesCount); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFind, goTo]);

  // Drag the panel's edge to make it wider or narrower.
  function grip(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const clamp = (w: number) => Math.round(Math.max(320, Math.min(w, Math.min(820, window.innerWidth * 0.62))));
    const move = (ev: PointerEvent) => setAskWidth(clamp(window.innerWidth - ev.clientX));
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      store("ask:width", askWidthRef.current);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  function askAbout() {
    if (!selection) return;
    setQuote({ text: selection.text, n: Date.now() });
    setAskingSaved(true);
    setSelection(null);
  }

  if (error) {
    return (
      <main className="book-error">
        <p className="notice bad">No se pudo abrir el PDF: {error}</p>
        <p><a className="btn" href={`#/r/${id}/${unitKey}?classic=1`}>Abrir como imágenes</a> <a href={`#/w/${id}`}>Volver</a></p>
      </main>
    );
  }

  const zoomKnown = ZOOMS.some(([v]) => v === scale.value);
  const findNote = !found || !query ? ""
    : found.state === NOT_FOUND ? "Sin resultados"
    : found.total ? `${found.current} de ${found.total}${found.state === WRAPPED ? " · volvió al principio" : ""}`
    : "";
  const sideOpen = prefs.side !== "" && ready;
  const unit = work?.unitList.find((u) => u.key === unitKey);

  return (
    <div ref={root} className={`book t-${prefs.theme} ${presenting ? "present" : ""} ${sideOpen ? "with-side" : ""} ${asking ? "asking" : ""}`}
         style={{ "--ask-w": `${askWidth}px` } as React.CSSProperties}>
      <header className="book-bar">
        <div className="book-group start">
          <a className="ctl back" href={`#/w/${id}`} title="Volver a la obra"><Icon name="back" /></a>
          <button className={`ctl ${prefs.side ? "on" : ""}`} onClick={() => toggleSide(prefs.side || (outline?.length ? "outline" : "thumbs"))}
                  aria-pressed={!!prefs.side} title="Índice y miniaturas"><Glyph name="sidebar" /></button>
          <span className="book-title" title={work?.title}>{work?.title}{unit && work && unit.label !== work.title ? <span className="faint"> · {unit.label}</span> : null}</span>
        </div>

        <div className="book-group middle">
          <label className="book-page">
            <input inputMode="numeric" aria-label="Página" value={pageDraft ?? String(page || "")}
                   onFocus={(e) => { setPageDraft(String(page)); setTimeout(() => e.target.select(), 0); }}
                   onChange={(e) => setPageDraft(e.target.value.replace(/\D/g, ""))}
                   onBlur={() => setPageDraft(null)}
                   onKeyDown={(e) => {
                     if (e.key === "Enter") { goTo(Number(pageDraft)); setPageDraft(null); e.currentTarget.blur(); }
                     if (e.key === "Escape") { setPageDraft(null); e.currentTarget.blur(); }
                   }} />
            <span className="faint">/ {count || "…"}</span>
          </label>
          <span className="book-sep" />
          <button className="ctl zoom-step" onClick={() => kit.current?.viewer.decreaseScale()} title="Alejar (Ctrl/⌘ −)" aria-label="Alejar"><Glyph name="minus" /></button>
          <select className="book-zoom" value={zoomKnown ? scale.value : "custom"} onChange={(e) => zoom(e.target.value)} aria-label="Zoom">
            {!zoomKnown && <option value="custom">{scale.pct} %</option>}
            {ZOOMS.map(([v, label]) => <option key={v} value={v}>{isPreset(v) && v === scale.value ? `${label} (${scale.pct} %)` : label}</option>)}
          </select>
          <button className="ctl zoom-step" onClick={() => kit.current?.viewer.increaseScale()} title="Acercar (Ctrl/⌘ +)" aria-label="Acercar"><Glyph name="plus" /></button>
          <button className={`ctl wide-only ${scale.value === "page-width" ? "on" : ""}`}
                  onClick={() => zoom(scale.value === "page-width" ? "page-fit" : "page-width")}
                  title={scale.value === "page-width" ? "Ajustar a la página" : "Ajustar al ancho"}><Glyph name="fit" /></button>
          <span className="book-sep wide-only" />
          <button className="ctl wide-only" onClick={() => rotate(-90)} title="Rotar a la izquierda"><Glyph name="rotateLeft" /></button>
          <button className="ctl wide-only" onClick={() => rotate(90)} title="Rotar a la derecha"><Glyph name="rotate" /></button>
        </div>

        <div className="book-group end">
          <button className={`ctl ${finding ? "on" : ""}`} onClick={() => (finding ? closeFind() : openFind())} title="Buscar (Ctrl/⌘ F)" aria-pressed={finding}>
            <Icon name="search" />
          </button>
          <div className="menu-wrap">
            <button className={`ctl ${menu ? "on" : ""}`} onClick={() => setMenu(!menu)} aria-haspopup="dialog" aria-expanded={menu} title="Cómo ver el libro">
              <Icon name="sliders" />
            </button>
            {menu && (
              <div className="menu book-menu" role="dialog" aria-label="Cómo ver el libro">
                <div className="menu-head">Desplazamiento</div>
                <div className="chips">
                  {([[SCROLL.vertical, "Vertical"], [SCROLL.page, "De a una página"], [SCROLL.horizontal, "Horizontal"], [SCROLL.wrapped, "Mosaico"]] as const).map(([m, label]) => (
                    <button key={m} className={prefs.scroll === m ? "on" : ""} aria-pressed={prefs.scroll === m} onClick={() => setPref("scroll", m)}>{label}</button>
                  ))}
                </div>
                <div className="menu-head">Páginas</div>
                <div className="chips">
                  {([[SPREAD.none, "Una"], [SPREAD.odd, "Dobles"], [SPREAD.even, "Dobles con tapa"]] as const).map(([m, label]) => (
                    <button key={m} className={prefs.spread === m ? "on" : ""} aria-pressed={prefs.spread === m} onClick={() => setPref("spread", m)}
                            disabled={prefs.scroll === SCROLL.horizontal && m !== SPREAD.none}>{label}</button>
                  ))}
                </div>
                <div className="menu-head">Color del papel</div>
                <div className="chips swatches">
                  {THEMES.map(([t, label]) => (
                    <button key={t} className={prefs.theme === t ? "on" : ""} aria-pressed={prefs.theme === t} onClick={() => setPref("theme", t)}>
                      <span className={`swatch s-${t}`} aria-hidden="true" />{label}
                    </button>
                  ))}
                </div>
                <div className="menu-head">Más</div>
                <button className="menu-item" onClick={() => { rotate(-90); }}><Glyph name="rotateLeft" /><span>Rotar a la izquierda</span></button>
                <button className="menu-item" onClick={() => { rotate(90); }}><Glyph name="rotate" /><span>Rotar a la derecha</span></button>
                <button className="menu-item" onClick={present}><Glyph name="present" /><span>Modo presentación</span></button>
                <a className="menu-item" href={`${base}/file`} download><Glyph name="download" /><span>Descargar el PDF</span></a>
                <a className="menu-item" href={`#/r/${id}/${unitKey}?classic=1&p=${page}`}><Icon name="image" /><span>Ver como imágenes</span></a>
                <p className="faint small menu-note">Ctrl/⌘ + rueda o pellizco para el zoom · Ctrl/⌘ F para buscar · ← → para pasar de página. Se recuerda para este libro, en este navegador.</p>
              </div>
            )}
          </div>
          <button className="ctl wide-only" onClick={toggleFull} title={full ? "Salir de pantalla completa" : "Pantalla completa"}>
            <Glyph name={full ? "shrink" : "expand"} />
          </button>
          {canAsk && (
            <button className={`ctl ask-toggle ${asking ? "on" : ""}`} onClick={() => setAskingSaved(!asking)} aria-pressed={asking} title="Preguntar sobre esta página">
              <Icon name="chat" />
            </button>
          )}
        </div>
        <div className="reader-progress"><div style={{ width: `${(page / Math.max(1, count)) * 100}%` }} /></div>
      </header>

      {finding && (
        <div className="book-find" role="search">
          <Icon name="search" />
          <input ref={findBox} value={query} placeholder="Buscar en el libro" aria-label="Buscar en el libro"
                 onChange={(e) => setQuery(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === "Enter") { e.preventDefault(); runFind("again", e.shiftKey); }
                   if (e.key === "Escape") { e.preventDefault(); closeFind(); }
                 }} />
          <span className={`find-note ${found?.state === NOT_FOUND ? "bad" : ""}`} aria-live="polite">{findNote}</span>
          <button className="ctl" onClick={() => runFind("again", true)} title="Anterior (Shift+Enter)" aria-label="Anterior"><Glyph name="up" /></button>
          <button className="ctl" onClick={() => runFind("again")} title="Siguiente (Enter)" aria-label="Siguiente"><Glyph name="down" /></button>
          <label className="find-case"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Aa</label>
          <button className="ctl" onClick={closeFind} aria-label="Cerrar la búsqueda"><Icon name="close" /></button>
        </div>
      )}

      {sideOpen && (
        <nav className="book-side" aria-label="Índice y miniaturas">
          <div className="side-tabs" role="tablist">
            <button role="tab" aria-selected={prefs.side === "outline"} className={prefs.side === "outline" ? "on" : ""} onClick={() => setPref("side", "outline")}
                    disabled={!outline?.length} title={outline?.length ? "" : "Este PDF no trae índice"}>Índice</button>
            <button role="tab" aria-selected={prefs.side === "thumbs"} className={prefs.side === "thumbs" ? "on" : ""} onClick={() => setPref("side", "thumbs")}>Páginas</button>
            <button className="ctl" onClick={() => setPref("side", "")} aria-label="Cerrar"><Icon name="close" /></button>
          </div>
          {prefs.side === "outline" && outline?.length ? (
            <Outline items={outline} onGo={(it) => {
              const k = kit.current;
              if (it.dest) void k?.link.goToDestination(it.dest as string);
              else if (it.url) window.open(it.url, "_blank", "noopener");
              if (narrow) setPref("side", "");
            }} />
          ) : kit.current ? (
            <Thumbs doc={kit.current.doc} count={count} page={page} onGo={(n) => { goTo(n); if (narrow) setPref("side", ""); }} />
          ) : null}
        </nav>
      )}

      <div className="book-main">
        <div ref={scroller} className="book-scroll" tabIndex={0}
             onClick={presenting ? (e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).closest(".page")) kit.current?.viewer.nextPage(); } : undefined}>
          <div ref={viewerDiv} className="pdfViewer" />
        </div>
        {!ready && (
          <div className="book-loading">
            <div className="spinner" aria-hidden="true" />
            <span>Abriendo el libro{loaded > 0 && loaded < 1 ? ` · ${Math.round(loaded * 100)} %` : "…"}</span>
          </div>
        )}
        {selection && (
          <button className="btn primary ask-selection" onMouseDown={(e) => e.preventDefault()} onClick={askAbout}
                  style={{ left: Math.max(80, Math.min(window.innerWidth - 80, selection.x)), top: Math.max(64, selection.y - 48) }}>
            <Icon name="chat" /> Preguntar sobre esto
          </button>
        )}
      </div>

      {asking && (
        <div className="ask-dock">
          {!narrow && <div className="ask-grip" onPointerDown={grip} role="separator" aria-orientation="vertical" aria-label="Ancho del panel" title="Arrastrá para cambiar el ancho" />}
          <AskPanel id={id} unitKey={unitKey} page={page || 1} onClose={() => setAskingSaved(false)} quote={quote} />
        </div>
      )}
    </div>
  );
}

/** The book's own index, as the PDF carries it; chapters open to show their sections. */
function Outline({ items, onGo, depth = 0 }: { items: OutlineNode[]; onGo: (it: OutlineNode) => void; depth?: number }) {
  return (
    <ul className={`outline ${depth ? "sub" : ""}`}>
      {items.map((it, i) => (
        <li key={i}>
          {it.items?.length ? (
            <details open={depth === 0 && items.length < 12}>
              <summary>
                <button className="outline-item" onClick={(e) => { e.preventDefault(); onGo(it); }}>{it.title}</button>
              </summary>
              <Outline items={it.items} onGo={onGo} depth={depth + 1} />
            </details>
          ) : (
            <button className="outline-item leaf" onClick={() => onGo(it)}>{it.title}</button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Small pictures of every page, drawn only as they scroll into view. */
function Thumbs({ doc, count, page, onGo }: { doc: PDFDocumentProxy; count: number; page: number; onGo: (n: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const done = new Set<number>();
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const canvas = entry.target as HTMLCanvasElement;
        const n = Number(canvas.dataset.n);
        if (done.has(n)) continue;
        done.add(n);
        io.unobserve(canvas);
        void doc.getPage(n).then((p) => {
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          const viewport = p.getViewport({ scale: (THUMB_W / p.getViewport({ scale: 1 }).width) * dpr });
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          return p.render({ canvas, viewport }).promise;
        }).catch(() => undefined);
      }
    }, { root: el, rootMargin: "600px 0px" });
    el.querySelectorAll("canvas[data-n]").forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [doc, count]);
  useEffect(() => {
    box.current?.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ block: "nearest" });
  }, [page]);
  return (
    <div className="thumbs" ref={box}>
      {Array.from({ length: count }, (_, i) => (
        <button key={i} data-page={i + 1} className={page === i + 1 ? "on" : ""} onClick={() => onGo(i + 1)} aria-label={`Página ${i + 1}`}>
          <canvas data-n={i + 1} width={THUMB_W} height={Math.round(THUMB_W * 1.4)} />
          <span>{i + 1}</span>
        </button>
      ))}
    </div>
  );
}
