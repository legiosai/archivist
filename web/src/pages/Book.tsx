import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { EventBus, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import { AuthError, api, saveProgress, unitPath, useQuery, type WorkDetail } from "../api.ts";
import { Icon } from "../icons.tsx";
import { touchScreen, useKeyboard } from "../keyboard.ts";
import { openPdf, quietL10n, textColumn, viewerKit, type PDFDocumentProxy } from "../pdf.ts";
import { AskPanel } from "./Ask.tsx";

// pdf.js constants, spelled out so the menus can be built before the library loads.
const SCROLL = { vertical: 0, horizontal: 1, wrapped: 2, page: 3 } as const;
const SPREAD = { none: 0, odd: 1, even: 2 } as const;
const FOUND = 0, NOT_FOUND = 1, WRAPPED = 2;

/** Below this width the viewer is laid out for a phone: bars over the page, sheets from below. */
const NARROW = "(max-width: 820px)";
/** A zoom of our own, next to pdf.js's: the column of words fills the width, the margins stay off screen. */
const TEXT = "text";
const MAX_TEXT_SCALE = 3;
/** Bumped when what is remembered per book changes meaning. */
const PREFS_V = 2;

type Theme = "original" | "sepia" | "dark" | "night";
type Side = "" | "thumbs" | "outline";
interface Prefs { v: number; scale: string; scroll: number; spread: number; theme: Theme; side: Side }
const DEFAULTS: Prefs = { v: PREFS_V, scale: "auto", scroll: SCROLL.vertical, spread: SPREAD.none, theme: "original", side: "" };

const ZOOMS: [string, string][] = [
  ["auto", "Automático"], ["page-fit", "Ajustar a la página"], ["page-width", "Ajustar al ancho"], [TEXT, "Ajustar al texto"],
  ["page-actual", "Tamaño real"],
  ["0.5", "50 %"], ["0.75", "75 %"], ["1", "100 %"], ["1.25", "125 %"], ["1.5", "150 %"], ["2", "200 %"], ["3", "300 %"], ["4", "400 %"],
];
const THEMES: [Theme, string][] = [["original", "Original"], ["sepia", "Sepia"], ["dark", "Oscuro"], ["night", "Noche"]];
const THUMB_W = 132;

interface OutlineNode { title: string; dest: string | unknown[] | null; url: string | null; items: OutlineNode[] }
interface Kit { viewer: PDFViewer; bus: EventBus; link: PDFLinkService; find: PDFFindController; doc: PDFDocumentProxy }
/** The parts of pdf.js's view of one page that the column fit reads. */
interface PageBox { width: number; scale: number; div: HTMLElement }

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

/**
 * How this book was last read in this browser. On a phone it opens fitted to the text unless the
 * reader chose otherwise since that fit exists, and the index starts closed: there it is a drawer.
 */
function firstPrefs(id: string): Prefs {
  const saved = stored<Partial<Prefs>>(`book:${id}`, {});
  const prefs: Prefs = { ...DEFAULTS, ...saved, v: PREFS_V };
  if (window.matchMedia(NARROW).matches) {
    prefs.side = "";
    if (saved.v !== PREFS_V || !saved.scale) prefs.scale = TEXT;
  }
  return prefs;
}

const isPreset = (v: string) => /^(auto|page-fit|page-width|page-actual)$/.test(v);
const isFit = (v: string) => v === TEXT || isPreset(v);

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
  // A page with its lines of text reaching both edges: the zoom that fits the words.
  words: <><path d="M4 6h16" /><path d="M4 10.5h16" /><path d="M4 15h16" /><path d="M4 19.5h10" /></>,
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
 * On a phone the page takes the whole screen: the words fill its width, a tap hides and shows the
 * bars, two taps show the whole page, and the index, the menu and the panel come up as sheets.
 * The page in view is saved as you go.
 */
export default function Book({ id, unitKey, onAuth }: { id: string; unitKey: string; onAuth: () => void }) {
  const base = unitPath(id, unitKey);
  const colKey = `bookcol:${id}/${unitKey}`;
  const startAt = Number(useQuery("p") ?? 0);
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(0);
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(() => firstPrefs(id));
  const [scale, setScale] = useState({ value: prefs.scale, pct: 100 });
  const [fitted, setFitted] = useState(false);
  const [menu, setMenu] = useState(false);
  const [canAsk, setCanAsk] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askWidth, setAskWidth] = useState(() => stored("ask:width", 420));
  const [askTall, setAskTall] = useState(false);
  const [typing, setTyping] = useState(false);
  const [held, setHeld] = useState<number | null>(null);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [found, setFound] = useState<{ state: number; current: number; total: number } | null>(null);
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const [selection, setSelection] = useState<{ text: string; x: number; top: number; bottom: number } | null>(null);
  const [quote, setQuote] = useState<{ text: string; n: number } | null>(null);
  const [full, setFull] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  const [calm, setCalm] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hint, setHint] = useState(false);
  const keyboard = useKeyboard();

  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const viewerDiv = useRef<HTMLDivElement>(null);
  const findBox = useRef<HTMLInputElement>(null);
  const kit = useRef<Kit | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const where = useRef({ page: 0, count: 0 });
  where.current = { page, count };
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;
  const bar = useRef<HTMLElement>(null);
  const calmRef = useRef(calm);
  calmRef.current = calm;
  const presentingRef = useRef(presenting);
  presentingRef.current = presenting;
  const beforePresenting = useRef<Pick<Prefs, "scale" | "scroll" | "spread"> | null>(null);
  const askWidthRef = useRef(askWidth);
  askWidthRef.current = askWidth;
  /** The zoom asked for (a pdf.js value, a number or "text"), which is what is remembered. */
  const wanted = useRef(prefs.scale);
  /** The scale that fits the column to the width, while that is the zoom in use. */
  const fit = useRef<number | null>(null);
  /** Where the page is held sideways while the column is fitted. */
  const lockLeft = useRef<number | null>(null);
  /** The words' column: [left, right] of the page's width, `null` without text, `undefined` until known. */
  const col = useRef<[number, number] | null | undefined>(undefined);
  const looking = useRef(false);
  const scrubRef = useRef<number | null>(null);
  const scrubTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The scale that fits the words to the width. None with two pages side by side, pages in a row or
  // turned on their side, or a book without text: there the page's own width is the fit.
  const textScale = useCallback((): number | null => {
    const v = kit.current?.viewer, el = scroller.current, c = col.current;
    if (!v || !el || !c || v.pagesRotation % 180 !== 0) return null;
    if (v.spreadMode !== SPREAD.none || (v.scrollMode !== SCROLL.vertical && v.scrollMode !== SCROLL.page)) return null;
    const box = v.getPageView(v.currentPageNumber - 1) as unknown as PageBox | undefined;
    if (!box?.width || !box.scale || !el.clientWidth) return null;
    const s = el.clientWidth / ((c[1] - c[0]) * (box.width / box.scale));
    return Math.round(Math.min(MAX_TEXT_SCALE, s) * 1000) / 1000;
  }, []);

  // Put the column in the middle of the view, and hold it there.
  const align = useCallback(() => {
    const v = kit.current?.viewer, el = scroller.current, c = col.current;
    if (!v || !el || !c || fit.current === null) { lockLeft.current = null; return; }
    const box = v.getPageView(v.currentPageNumber - 1) as unknown as PageBox | undefined;
    if (!box?.div) return;
    const middle = box.div.offsetLeft + box.div.clientLeft + ((c[0] + c[1]) / 2) * box.width;
    const left = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, Math.round(middle - el.clientWidth / 2)));
    lockLeft.current = left;
    if (Math.abs(el.scrollLeft - left) > 1) el.scrollLeft = left;
  }, []);

  // What the zoom is now, as the menus show it and as it is remembered.
  const noteScale = useCallback((s: number, preset?: string) => {
    const text = wanted.current === TEXT && (fit.current === null ? preset === "page-width" : Math.abs(s - fit.current) < 0.002);
    if (!text) {
      fit.current = null;
      lockLeft.current = null;
      wanted.current = preset ?? String(Math.round(s * 1000) / 1000);
    }
    const value = wanted.current, pct = Math.round(s * 100);
    setScale((was) => (was.value === value && was.pct === pct ? was : { value, pct }));
    setFitted(text && fit.current !== null);
  }, []);

  const zoom = useCallback((value: string) => {
    const v = kit.current?.viewer;
    if (!v) return;
    wanted.current = value;
    if (value === TEXT) {
      fit.current = textScale();
      v.currentScaleValue = fit.current === null ? "page-width" : String(fit.current);
      align();
    } else {
      fit.current = null;
      v.currentScaleValue = value;
    }
    noteScale(v.currentScale, isPreset(v.currentScaleValue) ? v.currentScaleValue : undefined);
  }, [textScale, align, noteScale]);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // On a phone the bar lies over the top of the page. After a jump made with the bar in view, the
  // page moves down by the bar's height, so its first lines are not under it.
  const clearBar = useCallback(() => {
    const el = scroller.current, b = bar.current;
    if (!el || !b || !narrowRef.current || calmRef.current) return;
    if (kit.current?.viewer.scrollMode !== SCROLL.vertical) return;
    el.scrollTop = Math.max(0, el.scrollTop - b.offsetHeight);
  }, []);

  // Find the words' column, once per book and browser; then fit to it if that is the zoom asked for.
  const findColumn = useCallback(() => {
    const k = kit.current;
    if (!k || col.current !== undefined || looking.current) return;
    looking.current = true;
    const doc = k.doc;
    const same = () => kit.current?.doc === doc;
    textColumn(doc, k.viewer.currentPageNumber || 1, same)
      .then((c) => {
        if (!same()) return;
        col.current = c;
        store(colKey, { pages: doc.numPages, col: c });
        if (wanted.current === TEXT) zoomRef.current(TEXT);
      })
      .catch(() => undefined)   // the pages could not be read: try again the next time the book is opened
      .finally(() => { looking.current = false; });
  }, [colKey]);
  const findColumnRef = useRef(findColumn);
  findColumnRef.current = findColumn;

  // Open the book: the work, whether there is a model to ask, then the PDF itself.
  useEffect(() => {
    let dead = false;
    let task: ReturnType<typeof openPdf> | null = null;
    setReady(false);
    setError("");
    col.current = undefined;
    fit.current = null;
    lockLeft.current = null;
    (async () => {
      try {
        const [w, meta] = await Promise.all([
          api<WorkDetail>(`/api/v1/works/${id}`),
          api<{ count: number; assistant?: boolean }>(`${base}/pages`),
        ]);
        if (dead) return;
        setWork(w);
        setCanAsk(Boolean(meta.assistant));
        // Beside the page it opens as it was left. On a phone it is a sheet over half of the page: it opens when asked.
        setAsking(meta.assistant && !window.matchMedia(NARROW).matches ? stored("ask:open", true) : false);
        const unit = w.unitList.find((u) => u.key === unitKey);
        const saved = unit?.progress && !unit.progress.finished ? unit.progress.position : 1;
        const start = Math.max(1, startAt || saved);

        const lib = await viewerKit();
        if (dead || !scroller.current || !viewerDiv.current) return;
        const bus = new lib.EventBus();
        // The index of a PDF often asks for its own zoom at each entry; the reader's zoom stays.
        const link = new lib.PDFLinkService({ eventBus: bus, externalLinkTarget: lib.LinkTarget.BLANK, externalLinkRel: "noopener noreferrer nofollow",
          ignoreDestinationZoom: true });
        const find = new lib.PDFFindController({ eventBus: bus, linkService: link });
        const viewer = new lib.PDFViewer({
          container: scroller.current, viewer: viewerDiv.current, eventBus: bus, linkService: link, findController: find,
          // On a phone every pixel of width is text: no frame around the page.
          removePageBorders: window.matchMedia(NARROW).matches || touchScreen(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          l10n: quietL10n as any,
        });
        link.setViewer(viewer);

        bus.on("pagesinit", () => {
          const p = prefsRef.current;
          viewer.scrollMode = p.scroll;
          viewer.spreadMode = p.spread;
          if (start > 1) viewer.currentPageNumber = Math.min(start, viewer.pagesCount);
          zoomRef.current(p.scale);
          if (start > 1) clearBar();
          setPage(viewer.currentPageNumber);
          setReady(true);
          scroller.current?.focus({ preventScroll: true });
          if (p.scale === TEXT) findColumnRef.current();
        });
        bus.on("pagechanging", (e: { pageNumber: number }) => {
          setPage(e.pageNumber);
          if (fit.current !== null) requestAnimationFrame(align);
        });
        bus.on("scalechanging", (e: { scale: number; presetValue?: string }) => noteScale(e.scale, e.presetValue));
        bus.on("updatefindmatchescount", (e: { matchesCount: { current: number; total: number } }) =>
          setFound((f) => ({ state: f?.state ?? FOUND, current: e.matchesCount.current, total: e.matchesCount.total })));
        bus.on("updatefindcontrolstate", (e: { state: number; matchesCount?: { current: number; total: number } }) =>
          setFound({ state: e.state, current: e.matchesCount?.current ?? 0, total: e.matchesCount?.total ?? 0 }));

        task = openPdf(`${base}/file`);
        task.onProgress = ({ loaded: l, total }: { loaded: number; total: number }) => total && setLoaded(Math.min(1, l / total));
        const doc = await task.promise;
        if (dead) return;   // the cleanup below destroys the task, and the document with it
        const known = stored<{ pages: number; col: [number, number] | null } | null>(colKey, null);
        if (known && known.pages === doc.numPages) col.current = known.col;
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
    let changed = false;
    if (v.scrollMode !== prefs.scroll) { v.scrollMode = prefs.scroll; changed = true; }
    if (v.spreadMode !== prefs.spread) { v.spreadMode = prefs.spread; changed = true; }
    if (changed && wanted.current === TEXT) zoom(TEXT);   // the column only fits one page under another
  }, [prefs.scroll, prefs.spread, ready, zoom]);

  // A fitted zoom follows the space it has: window, index or panel opening or closing, a phone turned.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const v = kit.current?.viewer;
      if (!v?.pagesCount) return;
      if (wanted.current === TEXT) zoomRef.current(TEXT);
      else if (isPreset(v.currentScaleValue)) v.currentScaleValue = v.currentScaleValue;
      else v.update();
    });
    ro.observe(el);
    // pdf.js moves the page sideways to show a match or a link's target: the column comes back.
    const hold = () => {
      const left = lockLeft.current;
      if (left !== null && Math.abs(el.scrollLeft - left) > 1) el.scrollLeft = left;
    };
    el.addEventListener("scroll", hold, { passive: true });
    const mq = window.matchMedia(NARROW);
    const onMq = () => setNarrow(mq.matches);
    mq.addEventListener("change", onMq);
    return () => { ro.disconnect(); el.removeEventListener("scroll", hold); mq.removeEventListener("change", onMq); };
  }, []);

  // Zoom the way a PDF viewer does: Ctrl/⌘ + wheel, a trackpad pinch, two fingers on a screen.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const zoomBy = (factor: number, x: number, y: number) => {
      if (!Number.isFinite(factor) || factor === 1) return;
      // pdf.js measures the point from the container's own corner, not from the screen's.
      const r = el.getBoundingClientRect();
      kit.current?.viewer.updateScale({ drawingDelay: 250, scaleFactor: factor, origin: [x - r.left + el.offsetLeft, y - r.top + el.offsetTop] });
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
    // Safari tells of a pinch twice on a phone, as a gesture and as two touches: there the touches
    // do the zooming, and the gesture is only kept from zooming the whole page.
    let gesture = 1;
    let fingers = 0;
    const onGestureStart = (e: Event) => { e.preventDefault(); gesture = 1; };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (fingers) return;
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      zoomBy(g.scale / gesture, g.clientX, g.clientY);
      gesture = g.scale;
    };
    let pinch: number | null = null;
    let dragFrom: number | null = null;
    const span = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const onTouchStart = (e: TouchEvent) => {
      fingers = e.touches.length;
      pinch = e.touches.length === 2 ? span(e.touches) : null;
      dragFrom = e.touches.length === 1 ? e.touches[0]!.clientY : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (pinch === null || e.touches.length !== 2) {
        // Reading on: a finger pushing the page up puts the bars away. A tap brings them back.
        if (dragFrom !== null && e.touches.length === 1 && dragFrom - e.touches[0]!.clientY > 36 && narrowRef.current) { dragFrom = null; setCalm(true); }
        return;
      }
      e.preventDefault();
      const d = span(e.touches);
      zoomBy(d / pinch, (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2, (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2);
      pinch = d;
    };
    const onTouchEnd = (e: TouchEvent) => {
      fingers = e.touches.length;
      if (e.touches.length < 2) pinch = null;
      if (!e.touches.length) dragFrom = null;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  // A finger on the page. One tap hides or shows the bars (in the middle, when pages turn one by
  // one: the sides turn the page, and so does a swipe). Two taps go between the words filling the
  // width and the whole page. Pressing and holding still selects text, and links still open.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let down: { x: number; y: number; t: number; id: number } | null = null;
    let last: { x: number; y: number; t: number } | null = null;
    let single: ReturnType<typeof setTimeout> | undefined;
    let fingers = 0;
    const turn = (by: number) => {
      const v = kit.current?.viewer;
      if (!v) return;
      if (by > 0) v.nextPage();
      else v.previousPage();
    };
    const tap = (x: number) => {
      if (!narrowRef.current) return;
      const v = kit.current?.viewer;
      const side = x / window.innerWidth;
      if (v?.scrollMode === SCROLL.page && side < 0.24) turn(-1);
      else if (v?.scrollMode === SCROLL.page && side > 0.76) turn(1);
      else setCalm((c) => !c);
    };
    const twice = (x: number, y: number) => {
      const v = kit.current?.viewer;
      if (!v) return;
      if (wanted.current !== TEXT) { zoomRef.current(TEXT); findColumnRef.current(); }
      else if (fit.current !== null) zoomRef.current("page-width");
      else {
        // No column to fit (a scanned book): twice as close around the finger, and back.
        const r = el.getBoundingClientRect();
        v.updateScale({ drawingDelay: 250, scaleFactor: 2, origin: [x - r.left + el.offsetLeft, y - r.top + el.offsetTop] });
      }
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      fingers++;
      down = fingers === 1 ? { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId } : null;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      fingers = Math.max(0, fingers - 1);
      const d = down;
      down = null;
      if (!d || e.pointerId !== d.id || presentingRef.current) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y, dt = e.timeStamp - d.t;
      if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy) && dt < 600) {
        if (kit.current?.viewer.scrollMode === SCROLL.page) turn(dx < 0 ? 1 : -1);
        return;
      }
      if (Math.hypot(dx, dy) > 12 || dt > 400) return;
      if ((e.target as Element | null)?.closest?.("a, button, input, textarea, select")) return;
      if (window.getSelection()?.toString().trim()) return;   // this tap is putting a selection away
      clearTimeout(single);
      if (last && e.timeStamp - last.t < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 44) {
        last = null;
        twice(e.clientX, e.clientY);
        return;
      }
      last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      const x = e.clientX;
      single = setTimeout(() => tap(x), 270);
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      fingers = Math.max(0, fingers - 1);
      down = null;
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    return () => {
      clearTimeout(single);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
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
      setSelection({ text: text.slice(0, 1200), x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
    };
    let t: ReturnType<typeof setTimeout> | undefined;
    const later = () => { clearTimeout(t); t = setTimeout(check, 0); };
    // On a phone the selection grows by dragging its handles, which the page hears only as this.
    const changed = () => { clearTimeout(t); t = setTimeout(check, 350); };
    const clear = () => setSelection(null);
    el.addEventListener("mouseup", later);
    el.addEventListener("touchend", later);
    el.addEventListener("keyup", later);
    el.addEventListener("scroll", clear, { passive: true });
    if (touchScreen()) document.addEventListener("selectionchange", changed);
    return () => {
      clearTimeout(t);
      el.removeEventListener("mouseup", later);
      el.removeEventListener("touchend", later);
      el.removeEventListener("keyup", later);
      el.removeEventListener("scroll", clear);
      document.removeEventListener("selectionchange", changed);
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
  /** A jump to read from there: on a phone the bars go away, and the page shows from its first line. */
  const jump = useCallback((n: number) => {
    goTo(n);
    if (narrowRef.current) setCalm(true);
  }, [goTo]);
  const pick = useCallback((value: string) => {
    zoom(value);
    if (value === TEXT) findColumn();
  }, [zoom, findColumn]);
  const rotate = useCallback((by: number) => {
    const v = kit.current?.viewer;
    if (!v) return;
    v.pagesRotation = (v.pagesRotation + by + 360) % 360;
    if (wanted.current === TEXT) zoom(TEXT);
  }, [zoom]);
  const setPref = useCallback(<K extends keyof Prefs>(k: K, value: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: value })), []);
  const toggleSide = useCallback((side: Side) => setPrefs((p) => ({ ...p, side: p.side === side ? "" : side })), []);
  const setAskingSaved = useCallback((a: boolean) => { setAsking(a); store("ask:open", a); if (!a) setAskTall(false); }, []);

  // The bar under the page on a phone: drag to another page; it opens when the finger lets go.
  const commitScrub = useCallback(() => {
    clearTimeout(scrubTimer.current);
    const n = scrubRef.current;
    if (n === null) return;
    scrubRef.current = null;
    setScrub(null);
    goTo(n);
    clearBar();
  }, [goTo, clearBar]);
  const scrubTo = useCallback((n: number) => {
    scrubRef.current = n;
    setScrub(n);
    clearTimeout(scrubTimer.current);
    scrubTimer.current = setTimeout(commitScrub, 600);   // a browser that never says the finger left
  }, [commitScrub]);
  useEffect(() => () => clearTimeout(scrubTimer.current), []);

  // Full screen, and presenting: one page at a time that fills the screen, as before when it ends.
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen?.().catch(() => undefined);
  }, []);
  const present = useCallback(() => {
    const v = kit.current?.viewer;
    if (!v || !root.current?.requestFullscreen) return;
    beforePresenting.current = { scale: wanted.current, scroll: prefsRef.current.scroll, spread: prefsRef.current.spread };
    setPresenting(true);
    setMenu(false);
    setPrefs((p) => ({ ...p, scroll: SCROLL.page, spread: SPREAD.none }));
    void root.current.requestFullscreen().catch(() => undefined);
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
      const inField = e.target instanceof HTMLElement && !!e.target.closest("input, textarea, select, [contenteditable]");
      if (mod && !e.altKey && (e.key === "f" || e.key === "F")) { e.preventDefault(); openFind(); return; }
      if (mod && (e.key === "+" || e.key === "=")) { e.preventDefault(); k.viewer.increaseScale(); return; }
      if (mod && e.key === "-") { e.preventDefault(); k.viewer.decreaseScale(); return; }
      if (mod && e.key === "0") { e.preventDefault(); zoomRef.current("auto"); return; }
      if (e.key === "Escape") { setSelection(null); setMenu(false); return; }
      if (inField || mod || e.altKey) return;
      const el = scroller.current!;
      const oneAtATime = k.viewer.scrollMode === SCROLL.page;
      const noSideways = el.scrollWidth <= el.clientWidth + 1 || fit.current !== null;
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

  // The first time the bars go away in this browser, a line says how to bring them back.
  const sideOpen = prefs.side !== "" && ready;
  const bare = narrow && calm && !menu && !sideOpen && !finding && !presenting;
  useEffect(() => {
    if (!bare || stored("book:hint", false)) return;
    store("book:hint", true);
    setHint(true);
    const t = setTimeout(() => setHint(false), 3800);
    return () => { clearTimeout(t); setHint(false); };
  }, [bare]);

  // On a phone the panel can take the whole screen (asked for, or while typing with the keyboard
  // up). The page under it then has more room than the reader was looking at, so the page a
  // question goes with stays the one that was in view before the panel grew.
  const tall = narrow && asking && (askTall || (typing && keyboard !== null));
  useLayoutEffect(() => { setHeld(tall ? where.current.page || 1 : null); }, [tall]);

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
  const unit = work?.unitList.find((u) => u.key === unitKey);
  const shown = scrub ?? page;
  const canPresent = typeof document !== "undefined" && document.fullscreenEnabled;
  const openSide = () => toggleSide(prefs.side || (outline?.length ? "outline" : "thumbs"));
  const classes = ["book", `t-${prefs.theme}`, presenting && "present", sideOpen && "with-side", asking && "asking", finding && "finding",
    fitted && "fitted", bare && "bare", tall && "ask-tall"].filter(Boolean).join(" ");
  // While someone types on a phone, the viewer is the part of the screen the keyboard leaves free.
  const frame = keyboard && narrow ? { top: keyboard.top, height: keyboard.height, bottom: "auto" } : null;

  const pageBox = (
    <label className="book-page">
      <input inputMode="numeric" aria-label="Página" value={pageDraft ?? String(shown || "")}
             onFocus={(e) => { setPageDraft(String(page)); setTimeout(() => e.target.select(), 0); }}
             onChange={(e) => setPageDraft(e.target.value.replace(/\D/g, ""))}
             onBlur={() => setPageDraft(null)}
             onKeyDown={(e) => {
               if (e.key === "Enter") { if (pageDraft) jump(Number(pageDraft)); setPageDraft(null); e.currentTarget.blur(); }
               if (e.key === "Escape") { setPageDraft(null); e.currentTarget.blur(); }
             }} />
      <span className="faint">/ {count || "…"}</span>
    </label>
  );

  return (
    <div ref={root} className={classes} style={{ "--ask-w": `${askWidth}px`, ...frame } as React.CSSProperties}>
      <header className="book-bar" ref={bar}>
        <div className="book-group start">
          <a className="ctl back" href={`#/w/${id}`} title="Volver a la obra" aria-label="Volver a la obra"><Icon name="back" /></a>
          {!narrow && (
            <button className={`ctl ${prefs.side ? "on" : ""}`} onClick={openSide} aria-pressed={!!prefs.side} title="Índice y miniaturas"><Glyph name="sidebar" /></button>
          )}
          <span className="book-title" title={work?.title}>{work?.title}{unit && work && unit.label !== work.title && work.unitList.length > 1 ? <span className="faint"> · {unit.label}</span> : null}</span>
        </div>

        {!narrow && (
          <div className="book-group middle">
            {pageBox}
            <span className="book-sep" />
            <button className="ctl zoom-step" onClick={() => kit.current?.viewer.decreaseScale()} title="Alejar (Ctrl/⌘ −)" aria-label="Alejar"><Glyph name="minus" /></button>
            <select className="book-zoom" value={zoomKnown ? scale.value : "custom"} onChange={(e) => pick(e.target.value)} aria-label="Zoom">
              {!zoomKnown && <option value="custom">{scale.pct} %</option>}
              {ZOOMS.map(([v, label]) => <option key={v} value={v}>{isFit(v) && v === scale.value ? `${label} (${scale.pct} %)` : label}</option>)}
            </select>
            <button className="ctl zoom-step" onClick={() => kit.current?.viewer.increaseScale()} title="Acercar (Ctrl/⌘ +)" aria-label="Acercar"><Glyph name="plus" /></button>
            <button className={`ctl wide-only ${scale.value === "page-width" ? "on" : ""}`}
                    onClick={() => zoom(scale.value === "page-width" ? "page-fit" : "page-width")}
                    title={scale.value === "page-width" ? "Ajustar a la página" : "Ajustar al ancho"}><Glyph name="fit" /></button>
            <span className="book-sep wide-only" />
            <button className="ctl wide-only" onClick={() => rotate(-90)} title="Rotar a la izquierda"><Glyph name="rotateLeft" /></button>
            <button className="ctl wide-only" onClick={() => rotate(90)} title="Rotar a la derecha"><Glyph name="rotate" /></button>
          </div>
        )}

        <div className="book-group end">
          {narrow && (
            <button className={`ctl ${scale.value === TEXT ? "on" : ""}`} onClick={() => pick(scale.value === TEXT ? "page-width" : TEXT)}
                    aria-pressed={scale.value === TEXT} title={scale.value === TEXT ? "Ver la página entera" : "Ajustar al texto"}
                    aria-label="Ajustar al texto"><Glyph name="words" /></button>
          )}
          <button className={`ctl ${finding ? "on" : ""}`} onClick={() => (finding ? closeFind() : openFind())} title="Buscar (Ctrl/⌘ F)" aria-label="Buscar en el libro" aria-pressed={finding}>
            <Icon name="search" />
          </button>
          <button className={`ctl ${menu ? "on" : ""}`} onClick={() => setMenu(!menu)} aria-haspopup="dialog" aria-expanded={menu} title="Cómo ver el libro" aria-label="Cómo ver el libro">
            <Icon name="sliders" />
          </button>
          <button className="ctl wide-only" onClick={toggleFull} title={full ? "Salir de pantalla completa" : "Pantalla completa"}>
            <Glyph name={full ? "shrink" : "expand"} />
          </button>
          {canAsk && (
            <button className={`ctl ask-toggle ${asking ? "on" : ""}`} onClick={() => setAskingSaved(!asking)} aria-pressed={asking} title="Preguntar sobre esta página" aria-label="Preguntar sobre esta página">
              <Icon name="chat" />
            </button>
          )}
        </div>
        <div className="reader-progress"><div style={{ width: `${(page / Math.max(1, count)) * 100}%` }} /></div>
      </header>

      {finding && (
        <div className="book-find" role="search">
          <Icon name="search" />
          <input ref={findBox} value={query} placeholder="Buscar en el libro" aria-label="Buscar en el libro" enterKeyHint="search"
                 onChange={(e) => setQuery(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === "Enter") { e.preventDefault(); runFind("again", e.shiftKey); }
                   if (e.key === "Escape") { e.preventDefault(); closeFind(); }
                 }} />
          <span className={`find-note ${found?.state === NOT_FOUND ? "bad" : ""}`} aria-live="polite">{findNote}</span>
          <button className="ctl" onClick={() => runFind("again", true)} title="Anterior (Shift+Enter)" aria-label="Anterior"><Glyph name="up" /></button>
          <button className="ctl" onClick={() => runFind("again")} title="Siguiente (Enter)" aria-label="Siguiente"><Glyph name="down" /></button>
          <label className="find-case" title="Distinguir mayúsculas"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Aa</label>
          <button className="ctl" onClick={closeFind} aria-label="Cerrar la búsqueda"><Icon name="close" /></button>
        </div>
      )}

      {sideOpen && narrow && <div className="book-shade" onClick={() => setPref("side", "")} aria-hidden="true" />}
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
              if (narrow) { setPref("side", ""); setCalm(true); }
            }} />
          ) : kit.current ? (
            <Thumbs doc={kit.current.doc} count={count} page={page} onGo={(n) => { jump(n); if (narrow) setPref("side", ""); }} />
          ) : null}
        </nav>
      )}

      <div className="book-main">
        <div ref={scroller} className="book-scroll" tabIndex={0}
             onClick={presenting ? (e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).closest(".page")) kit.current?.viewer.nextPage(); } : undefined}>
          <div ref={viewerDiv} className="pdfViewer" />
        </div>
        {narrow && <div className="book-progress" aria-hidden="true"><div style={{ width: `${(shown / Math.max(1, count)) * 100}%` }} /></div>}
        {!ready && (
          <div className="book-loading">
            <div className="spinner" aria-hidden="true" />
            <span>Abriendo el libro{loaded > 0 && loaded < 1 ? ` · ${Math.round(loaded * 100)} %` : "…"}</span>
          </div>
        )}
        {selection && (
          <button className="btn primary ask-selection" onMouseDown={(e) => e.preventDefault()} onClick={askAbout}
                  style={{
                    left: Math.max(96, Math.min(window.innerWidth - 96, selection.x)),
                    // A phone puts its own copy menu over the words: this one goes under them.
                    top: touchScreen() ? Math.min(window.innerHeight - 120, selection.bottom + 30) : Math.max(64, selection.top - 48),
                  }}>
            <Icon name="chat" /> Preguntar sobre esto
          </button>
        )}
        {hint && <div className="book-hint" role="status">Tocá la página para ver los controles</div>}
        {narrow && !presenting && (
          <footer className="book-foot">
            <button className={`ctl ${prefs.side ? "on" : ""}`} onClick={openSide} aria-pressed={!!prefs.side} title="Índice y miniaturas" aria-label="Índice y miniaturas">
              <Glyph name="sidebar" />
            </button>
            <input className="book-scrub" type="range" min={1} max={Math.max(1, count)} value={shown || 1} aria-label="Ir a otra página"
                   style={{ "--fill": `${((Math.max(1, shown) - 1) / Math.max(1, count - 1)) * 100}%` } as React.CSSProperties}
                   onChange={(e) => scrubTo(Number(e.target.value))}
                   onPointerUp={commitScrub} onPointerCancel={commitScrub} onTouchEnd={commitScrub} onKeyUp={commitScrub} onBlur={commitScrub} />
            {pageBox}
          </footer>
        )}
      </div>

      {menu && <div className="book-shade menu-shade" onClick={() => setMenu(false)} aria-hidden="true" />}
      {menu && (
        <div className="menu book-menu" role="dialog" aria-label="Cómo ver el libro">
          {narrow && (
            <>
              <div className="menu-head">Tamaño</div>
              <div className="chips">
                {([[TEXT, "Ajustar al texto"], ["page-width", "Ancho de la página"], ["page-fit", "Página entera"]] as const).map(([v, label]) => (
                  <button key={v} className={scale.value === v ? "on" : ""} aria-pressed={scale.value === v} onClick={() => pick(v)}>{label}</button>
                ))}
              </div>
              <div className="stepper">
                <button className="ctl" onClick={() => kit.current?.viewer.decreaseScale()} aria-label="Alejar"><Glyph name="minus" /></button>
                <span aria-live="polite">{scale.pct} %</span>
                <button className="ctl" onClick={() => kit.current?.viewer.increaseScale()} aria-label="Acercar"><Glyph name="plus" /></button>
              </div>
            </>
          )}
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
          {canPresent && <button className="menu-item" onClick={present}><Glyph name="present" /><span>Modo presentación</span></button>}
          <a className="menu-item" href={`${base}/file`} download><Glyph name="download" /><span>Descargar el PDF</span></a>
          <a className="menu-item" href={`#/r/${id}/${unitKey}?classic=1&p=${page}`}><Icon name="image" /><span>Ver como imágenes</span></a>
          <p className="faint small menu-note">
            {narrow
              ? "Un toque en la página esconde y muestra los controles · dos toques cambian entre el texto y la página entera · dos dedos para acercar."
              : "Ctrl/⌘ + rueda o pellizco para el zoom · Ctrl/⌘ F para buscar · ← → para pasar de página."}
            {" "}Se recuerda para este libro, en este navegador.
          </p>
        </div>
      )}

      {asking && (
        <div className="ask-dock" onFocus={(e) => setTyping(e.target instanceof HTMLTextAreaElement)}
             onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTyping(false); }}>
          {!narrow && <div className="ask-grip" onPointerDown={grip} role="separator" aria-orientation="vertical" aria-label="Ancho del panel" title="Arrastrá para cambiar el ancho" />}
          <AskPanel id={id} unitKey={unitKey} page={(tall && held) || page || 1} onClose={() => setAskingSaved(false)} quote={quote}
                    tall={tall} onTall={narrow ? setAskTall : undefined} />
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
