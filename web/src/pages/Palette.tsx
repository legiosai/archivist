import { useEffect, useRef, useState } from "react";
import { TYPE_LABEL, api, type Progress, type WorkSummary } from "../api.ts";
import { Icon } from "../icons.tsx";
import { Img, thumb } from "./parts.tsx";

interface Hit extends WorkSummary { score?: number }
interface Latest extends Progress { work: WorkSummary }

/**
 * Search from anywhere: Ctrl+K (⌘K) or the header button. Empty, it offers what you were reading;
 * typing asks the server (titles in any language, accents optional, years, ids).
 */
export function Palette() {
  const [shown, setShown] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [recent, setRecent] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const show = () => setShown(true);
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setShown((s) => !s); }
    };
    window.addEventListener("archivist:search", show);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("archivist:search", show); window.removeEventListener("keydown", key); };
  }, []);

  useEffect(() => {
    if (!shown) return;
    setQ(""); setSel(0);
    setTimeout(() => input.current?.focus(), 10);
    api<{ latest: Latest[] }>("/api/v1/progress").then((r) => setRecent(r.latest.slice(0, 6).map((l) => l.work))).catch(() => undefined);
  }, [shown]);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(() => {
      api<{ results: Hit[] }>(`/api/v1/search?q=${encodeURIComponent(q)}&limit=8`).then((r) => { setHits(r.results); setSel(0); })
        .catch(() => setHits([]));
    }, 120);
    return () => clearTimeout(t);
  }, [q]);

  if (!shown) return null;
  const list = q.trim() ? hits : recent;
  const open = (w: Hit | undefined) => { if (!w) return; setShown(false); window.location.hash = `#/w/${w.id}`; };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setShown(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") open(list[sel]);
  };

  return (
    <div className="palette-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setShown(false); }}>
      <div className="palette" role="dialog" aria-label="Buscar">
        <label className="palette-input">
          <Icon name="search" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
                 placeholder="Buscar una obra: título, original, año…" aria-label="Buscar" />
          <kbd>Esc</kbd>
        </label>
        <div className="palette-list" role="listbox">
          {!q.trim() && recent.length > 0 && <div className="palette-head">Seguir</div>}
          {list.map((w, i) => (
            <button key={w.id} role="option" aria-selected={i === sel} className={`palette-item ${i === sel ? "on" : ""}`}
                    onMouseEnter={() => setSel(i)} onClick={() => open(w)}>
              <span className="palette-cover">{w.cover ? <Img src={thumb(w.cover, 160)} /> : <span>{w.title.slice(0, 1)}</span>}</span>
              <span className="palette-text">
                <strong>{w.title}</strong>
                <span>{TYPE_LABEL[w.type]}{w.year ? ` · ${w.year}` : ""}{w.originalTitle && w.originalTitle !== w.title ? ` · ${w.originalTitle}` : ""}</span>
              </span>
              {w.units > 0 && <span className="palette-prog">{w.finished}/{w.units}</span>}
              <Icon name="next" className="icon go" />
            </button>
          ))}
          {q.trim() && hits.length === 0 && <p className="palette-empty">Nada con «{q}».</p>}
          {!q.trim() && recent.length === 0 && <p className="palette-empty">Escribí para buscar en toda la biblioteca.</p>}
        </div>
      </div>
    </div>
  );
}
