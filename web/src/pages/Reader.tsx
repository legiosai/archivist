import { useCallback, useEffect, useRef, useState } from "react";
import { AuthError, api, go, saveProgress, unitPath, useQuery, type WorkDetail } from "../api.ts";
import { Icon } from "../icons.tsx";

type Mode = "rtl" | "ltr" | "vertical";

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
 * Pages one or two at a time (right-to-left for manga, left-to-right for comics) or as one
 * vertical strip. Tap or click the sides, use the arrows, or swipe. The page is saved as you go.
 */
export function Reader({ id, unitKey, onAuth }: { id: string; unitKey: string; onAuth: () => void }) {
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<Mode>("rtl");
  const [double, setDouble] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState("");
  const startAt = Number(useQuery("p") ?? 0);
  const strip = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const base = unitPath(id, unitKey);
  const unitIndex = work?.unitList.findIndex((u) => u.key === unitKey) ?? -1;
  const unit = work?.unitList[unitIndex];
  const nextUnit = work && unitIndex >= 0 ? work.unitList[unitIndex + 1] : undefined;
  const prevUnit = work && unitIndex > 0 ? work.unitList[unitIndex - 1] : undefined;

  useEffect(() => {
    Promise.all([api<WorkDetail>(`/api/v1/works/${id}`), api<{ count: number }>(`${base}/pages`)])
      .then(([w, c]) => {
        setWork(w);
        setCount(c.count);
        const u = w.unitList.find((x) => x.key === unitKey);
        const saved = u?.progress && !u.progress.finished ? u.progress.position : 1;
        setPage(Math.min(c.count, Math.max(1, startAt || saved)));
        setMode(stored<Mode>(`mode:${id}`, (w.reading as Mode) || "rtl"));
        setDouble(stored(`double:${id}`, false));
      })
      .catch((e) => (e instanceof AuthError ? onAuth() : setError(String(e.message))));
  }, [id, unitKey, base, startAt, onAuth]);

  const step = double && mode !== "vertical" ? 2 : 1;
  const lastShown = Math.min(count, page + step - 1);

  // Save the page (the last one on screen), and let the next pages load ahead.
  useEffect(() => {
    if (!page || !count) return;
    const t = setTimeout(() => void saveProgress(id, unitKey, lastShown, count), 600);
    for (let n = page + step; n <= Math.min(count, page + step * 3); n++) new Image().src = `${base}/pages/${n}`;
    return () => clearTimeout(t);
  }, [page, count, lastShown, id, unitKey, base, step]);

  const forward = useCallback(() => {
    if (page + step <= count) setPage(page + step);
    else if (nextUnit) {
      void saveProgress(id, unitKey, count, count);
      go(`#/r/${id}/${nextUnit.key}?p=1`);
    }
  }, [page, step, count, nextUnit, id, unitKey]);

  const backward = useCallback(() => {
    if (page > 1) setPage(Math.max(1, page - step));
    else if (prevUnit) go(`#/r/${id}/${prevUnit.key}`);
  }, [page, step, prevUnit, id]);

  useEffect(() => {
    if (mode === "vertical") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") (mode === "rtl" ? backward : forward)();
      else if (e.key === "ArrowLeft") (mode === "rtl" ? forward : backward)();
      else if (e.key === " " || e.key === "PageDown") { e.preventDefault(); forward(); }
      else if (e.key === "PageUp") backward();
      else if (e.key === "Escape") go(`#/w/${id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, forward, backward, id]);

  // Vertical: the page in view is the one saved.
  useEffect(() => {
    if (mode !== "vertical" || !strip.current || !count) return;
    const imgs = [...strip.current.querySelectorAll<HTMLImageElement>("img[data-n]")];
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setPage(Number((e.target as HTMLElement).dataset.n));
    }, { threshold: 0.5 });
    imgs.forEach((i) => io.observe(i));
    imgs[page - 1]?.scrollIntoView();
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, count]);

  function tap(e: React.MouseEvent) {
    const x = e.clientX / window.innerWidth;
    if (x > 0.3 && x < 0.7) { setChrome(!chrome); return; }
    const leftSide = x <= 0.3;
    if (mode === "rtl") (leftSide ? forward : backward)();
    else (leftSide ? backward : forward)();
  }

  function swipe(e: React.TouchEvent) {
    const s = touch.current;
    touch.current = null;
    const t = e.changedTouches[0];
    if (!s || !t) return;
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
    const toLeft = dx < 0;     // a swipe to the left turns like a ltr book; reversed for manga
    if (mode === "rtl") (toLeft ? backward : forward)();
    else (toLeft ? forward : backward)();
  }

  function setModeSaved(m: Mode) { setMode(m); store(`mode:${id}`, m); }
  function setDoubleSaved(d: boolean) { setDouble(d); store(`double:${id}`, d); }

  if (error) return <main><p className="notice bad">{error}</p><a href={`#/w/${id}`}>Volver</a></main>;
  if (!work || !page) return <main className="reader-loading"><div className="spinner" aria-label="Abriendo" /></main>;

  const pages = mode === "vertical" ? [] : (step === 2 && lastShown > page ? [page, lastShown] : [page]);
  const ordered = mode === "rtl" ? [...pages].reverse() : pages;

  return (
    <div className={`reader ${chrome ? "" : "bare"}`}>
      <div className="reader-bar">
        <a className="back" href={`#/w/${id}`} title="Volver a la obra"><Icon name="back" /><span>{work.title}</span></a>
        <span className="pill">{unit?.label}</span>
        <div className="menu-wrap">
          <button className={`ctl ${settings ? "on" : ""}`} onClick={() => setSettings(!settings)} aria-haspopup="dialog" aria-expanded={settings} title="Cómo leer">
            <Icon name="sliders" />
          </button>
          {settings && (
            <div className="menu reading" role="dialog" aria-label="Cómo leer">
              <div className="menu-head">Sentido</div>
              <div className="seg" role="radiogroup" aria-label="Sentido de lectura">
                {([["rtl", "Derecha a izquierda", "Manga"], ["ltr", "Izquierda a derecha", "Cómic"], ["vertical", "Vertical", "Webtoon"]] as const).map(([m, label, hint]) => (
                  <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => setModeSaved(m)}>
                    <strong>{label}</strong><span>{hint}</span>
                  </button>
                ))}
              </div>
              {mode !== "vertical" && (
                <button className="menu-item toggle" role="switch" aria-checked={double} onClick={() => setDoubleSaved(!double)}>
                  <span>De a dos páginas</span><span className={`switch ${double ? "on" : ""}`} aria-hidden="true" />
                </button>
              )}
              <p className="faint small menu-note">Se recuerda para esta obra, en este navegador.</p>
            </div>
          )}
        </div>
        <div className="reader-progress"><div style={{ width: `${(lastShown / Math.max(1, count)) * 100}%` }} /></div>
      </div>
      {mode === "vertical" ? (
        <div className="strip" ref={strip}>
          {Array.from({ length: count }, (_, i) => (
            <img key={i} data-n={i + 1} src={`${base}/pages/${i + 1}`} alt={`Página ${i + 1}`} loading="lazy" />
          ))}
          {nextUnit && <a className="btn primary next-unit" href={`#/r/${id}/${nextUnit.key}?p=1`}>{nextUnit.label} →</a>}
        </div>
      ) : (
        <div className="stage" onClick={tap} onTouchStart={(e) => { const t = e.touches[0]; touch.current = t ? { x: t.clientX, y: t.clientY } : null; }}
             onTouchEnd={swipe}>
          {ordered.map((n) => <img key={n} src={`${base}/pages/${n}`} alt={`Página ${n}`} className={pages.length === 2 ? "half" : ""} />)}
        </div>
      )}
      {mode !== "vertical" && (
        <div className="reader-foot">
          <button className="ctl" onClick={mode === "rtl" ? forward : backward} aria-label={mode === "rtl" ? "Página siguiente" : "Página anterior"}><Icon name="back" /></button>
          <input type="range" min={1} max={count} value={page} dir={mode === "rtl" ? "rtl" : "ltr"}
                 onChange={(e) => setPage(Number(e.target.value))} aria-label="Página"
                 style={{ "--fill": `${((page - 1) / Math.max(1, count - 1)) * 100}%` } as React.CSSProperties} />
          <button className="ctl" onClick={mode === "rtl" ? backward : forward} aria-label={mode === "rtl" ? "Página anterior" : "Página siguiente"}><Icon name="next" /></button>
          <span className="page-count">{lastShown > page ? `${page}–${lastShown}` : page} <span className="faint">/ {count}</span></span>
          {page + step > count && nextUnit && <a className="btn primary" href={`#/r/${id}/${nextUnit.key}?p=1`}>Seguir con {nextUnit.label}</a>}
        </div>
      )}
    </div>
  );
}
