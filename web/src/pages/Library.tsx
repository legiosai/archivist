import { useEffect, useMemo, useState } from "react";
import { AuthError, TYPE_LABEL, api, type Progress, type WorkSummary, type WorkType } from "../api.ts";
import { Header } from "./parts.tsx";

interface Latest extends Progress { work: WorkSummary }

const TABS: (WorkType | "all")[] = ["all", "film", "series", "anime", "manga", "comic"];

export function Library({ onAuth }: { onAuth: () => void }) {
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [latest, setLatest] = useState<Latest[]>([]);
  const [tab, setTab] = useState<WorkType | "all">(() => (localStorage.getItem("tab") as WorkType | "all") || "all");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api<{ works: WorkSummary[] }>("/api/v1/works"), api<{ latest: Latest[] }>("/api/v1/progress")])
      .then(([w, p]) => { setWorks(w.works); setLatest(p.latest); })
      .catch((e) => (e instanceof AuthError ? onAuth() : setError(String(e.message))));
  }, [onAuth]);

  useEffect(() => { try { localStorage.setItem("tab", tab); } catch { /* private mode */ } }, [tab]);

  const shown = useMemo(() => (works ?? []).filter((w) => (tab === "all" || w.type === tab)
    && (!q || w.title.toLowerCase().includes(q.toLowerCase()))), [works, tab, q]);
  const keepGoing = latest.filter((l) => !(l.finished && l.work.finished >= l.work.units)).slice(0, 12);

  return (
    <>
      <Header />
      <main>
        {error && <p className="bad">{error}</p>}
        {keepGoing.length > 0 && (
          <section>
            <h2>Seguir</h2>
            <div className="shelf">
              {keepGoing.map((l) => (
                <a key={l.workId} className="tile wide" href={`#/w/${l.workId}`}>
                  {l.work.cover && <img src={l.work.cover} alt="" loading="lazy" />}
                  <div className="tile-text">
                    <span className="eyebrow">{TYPE_LABEL[l.work.type]}</span>
                    <strong>{l.work.title}</strong>
                    <span className="faint small">{l.finished ? "Terminaste esta parte" : l.work.kind === "video"
                      ? `Vas por ${Math.round((l.position / Math.max(1, l.total)) * 100)} %`
                      : `Página ${l.position} de ${l.total}`}</span>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}
        <section>
          <div className="spread">
            <div className="tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                  {t === "all" ? "Todo" : TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <input className="search" type="search" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {works === null ? <p className="faint">Cargando…</p> : shown.length === 0 ? (
            <p className="faint">Nada acá todavía. <a href="#/subir">Subir una obra</a>.</p>
          ) : (
            <div className="grid">
              {shown.map((w) => (
                <a key={w.id} className="tile" href={`#/w/${w.id}`}>
                  <div className="cover">{w.cover ? <img src={w.cover} alt="" loading="lazy" /> : <span>{w.title.slice(0, 1)}</span>}</div>
                  <strong>{w.title}</strong>
                  <span className="faint small">{TYPE_LABEL[w.type]}{w.year ? ` · ${w.year}` : ""} · {w.units} {w.kind === "video" ? (w.units === 1 ? "archivo" : "episodios") : "tomos"}</span>
                  {w.units > 0 && <div className="bar"><div style={{ width: `${(w.finished / w.units) * 100}%` }} /></div>}
                </a>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
