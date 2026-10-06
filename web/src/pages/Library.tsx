import { useEffect, useMemo, useRef, useState } from "react";
import { AuthError, TYPE_LABEL, api, clock, type Progress, type WorkSummary, type WorkType } from "../api.ts";
import { Icon } from "../icons.tsx";
import { useProfiles } from "../profiles.tsx";
import { Header, Img, SkeletonGrid, thumb } from "./parts.tsx";

interface Latest extends Progress { work: WorkSummary }

const TABS: (WorkType | "all")[] = ["all", "film", "series", "anime", "manga", "comic"];
type Status = "all" | "reading" | "unstarted" | "finished";
type Sort = "recent" | "title" | "year";
const STATUS: [Status, string][] = [["all", "Todo"], ["reading", "En curso"], ["unstarted", "Sin empezar"], ["finished", "Terminadas"]];

function statusOf(w: WorkSummary): Status {
  if (w.units && w.finished === w.units) return "finished";
  return w.last || w.finished ? "reading" : "unstarted";
}

function remembered<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) || fallback; } catch { return fallback; }
}

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

function unitsLabel(w: WorkSummary): string {
  if (w.kind === "video") return w.type === "film" ? (w.units === 1 ? "película" : `${w.units} archivos`) : `${w.units} ${w.units === 1 ? "episodio" : "episodios"}`;
  return `${w.units} ${w.units === 1 ? "tomo" : "tomos"}`;
}

function whereText(l: Latest): string {
  if (l.finished) return "Terminaste esta parte";
  if (l.work.kind === "video") return `${clock(l.position)} de ${clock(l.total)}`;
  return `Página ${l.position} de ${l.total}`;
}

const pct = (l: Progress) => Math.min(100, (l.position / Math.max(1, l.total)) * 100);

export function Library({ onAuth }: { onAuth: () => void }) {
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [latest, setLatest] = useState<Latest[]>([]);
  const { me } = useProfiles();
  const [tab, setTab] = useState<WorkType | "all">(() => remembered("tab", "all"));
  const [status, setStatus] = useState<Status>(() => remembered("status", "all"));
  const [sort, setSort] = useState<Sort>(() => remembered("sort", "recent"));
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([api<{ works: WorkSummary[] }>("/api/v1/works"), api<{ latest: Latest[] }>("/api/v1/progress")])
      .then(([w, p]) => { setWorks(w.works); setLatest(p.latest); })
      .catch((e) => (e instanceof AuthError ? onAuth() : setError(String(e.message))));
  }, [onAuth]);

  useEffect(() => {
    try { localStorage.setItem("tab", tab); localStorage.setItem("status", status); localStorage.setItem("sort", sort); } catch { /* private mode */ }
  }, [tab, status, sort]);

  // "/" jumps to the search box, as on most sites.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: works?.length ?? 0 };
    for (const w of works ?? []) c[w.type] = (c[w.type] ?? 0) + 1;
    return c;
  }, [works]);
  const shown = useMemo(() => {
    const list = (works ?? []).filter((w) => (tab === "all" || w.type === tab) && (status === "all" || statusOf(w) === status)
      && (!q || norm(`${w.title} ${w.originalTitle ?? ""} ${w.year ?? ""}`).includes(norm(q))));
    const byTitle = (a: WorkSummary, b: WorkSummary) => a.title.localeCompare(b.title, "es");
    if (sort === "title") return list.sort(byTitle);
    if (sort === "year") return list.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || byTitle(a, b));
    return list.sort((a, b) => (b.last?.updatedAt ?? "").localeCompare(a.last?.updatedAt ?? "") || byTitle(a, b));
  }, [works, tab, status, sort, q]);
  const surprise = () => {
    const pool = (works ?? []).filter((w) => statusOf(w) !== "finished" && w.units > 0);
    const w = pool[Math.floor(Math.random() * pool.length)];
    if (w) window.location.hash = `#/w/${w.id}`;
  };
  const keepGoing = latest.filter((l) => !(l.finished && l.work.finished >= l.work.units)).slice(0, 12);
  const hero = keepGoing[0];
  const finishedUnits = (works ?? []).reduce((n, w) => n + w.finished, 0);

  return (
    <>
      <Header active="library" />
      <main>
        {error && <p className="notice bad">{error}</p>}
        {works === null ? <div className="skeleton banner" /> : hero ? (
          <section className="hero">
            {hero.work.cover && <div className="hero-bg" style={{ backgroundImage: `url("${thumb(hero.work.cover, 480)}")` }} />}
            <div className="hero-body">
              {hero.work.cover && <Img className="hero-poster" src={thumb(hero.work.cover, 480)} />}
              <div className="hero-text">
                <span className="eyebrow">Seguí {hero.work.kind === "video" ? "viendo" : "leyendo"}{me ? `, ${me.name}` : ""} · {TYPE_LABEL[hero.work.type]}</span>
                <h1>{hero.work.title}</h1>
                <p className="meta">{whereText(hero)}</p>
                {!hero.finished && (
                  <div className="progress-line"><div className="bar"><div style={{ width: `${pct(hero)}%` }} /></div></div>
                )}
                <div className="row">
                  <a className="btn primary lg" href={`#/w/${hero.workId}`}>
                    <Icon name={hero.work.kind === "video" ? "play" : "book"} /> Seguir
                  </a>
                  <span className="faint small">{hero.work.finished} de {hero.work.units} {hero.work.kind === "video" ? "vistos" : "leídos"}</span>
                </div>
              </div>
            </div>
          </section>
        ) : works.length > 0 ? (
          <section className="hero welcome">
            <div className="hero-body">
              <div className="hero-text">
                <span className="eyebrow">{me ? `Hola, ${me.name}` : "Hola"}</span>
                <h1>¿Qué {works.some((w) => w.kind === "pages") ? "leemos" : "vemos"} hoy?</h1>
                <p className="meta">{works.length} {works.length === 1 ? "obra espera" : "obras esperan"}. Lo que empieces queda guardado en tu perfil.</p>
                <div className="row">
                  <button className="primary lg" onClick={surprise}><Icon name="play" /> Sorprendeme</button>
                  <a className="btn lg" href="#/subir"><Icon name="upload" /> Subir más</a>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="hero welcome">
            <div className="hero-body">
              <div className="hero-text">
                <span className="eyebrow">Tu biblioteca</span>
                <h1>Todo lo que tenés para leer y ver, en un lugar.</h1>
                <p className="meta">Y nunca se olvida dónde quedaste.</p>
                <a className="btn primary lg" href="#/subir"><Icon name="upload" /> Subir una obra</a>
              </div>
            </div>
          </section>
        )}

        {works && works.length > 0 && (
          <div className="stats">
            <div className="stat"><strong>{works.length}</strong><span>obras</span></div>
            <div className="stat"><strong>{works.reduce((n, w) => n + w.units, 0)}</strong><span>tomos y episodios</span></div>
            <div className="stat"><strong>{finishedUnits}</strong><span>terminados</span></div>
            <a className="stat-link" href="#/resumen"><Icon name="calendar" /> Tu año <Icon name="next" /></a>
          </div>
        )}

        {keepGoing.length > 1 && (
          <section>
            <h2>Seguir</h2>
            <div className="shelf">
              {keepGoing.slice(1).map((l, i) => (
                <a key={l.workId} className="resume" href={`#/w/${l.workId}`} style={{ "--i": i } as React.CSSProperties}>
                  {l.work.cover && <Img src={thumb(l.work.cover, 160)} />}
                  <div className="tile-text">
                    <span className="eyebrow">{TYPE_LABEL[l.work.type]}</span>
                    <strong>{l.work.title}</strong>
                    <span className="faint small">{whereText(l)}</span>
                    {!l.finished && <div className="bar"><div style={{ width: `${pct(l)}%` }} /></div>}
                  </div>
                  <span className="play"><Icon name={l.work.kind === "video" ? "play" : "book"} /></span>
                </a>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="toolbar">
            <div className="tabs" role="tablist">
              {TABS.filter((t) => t === "all" || counts[t]).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                  {t === "all" ? "Todo" : TYPE_LABEL[t]} <span className="count">{counts[t] ?? 0}</span>
                </button>
              ))}
            </div>
            <div className="row filters">
              <div className="chips-filter" role="radiogroup" aria-label="Estado">
                {STATUS.map(([s, label]) => (
                  <button key={s} role="radio" aria-checked={status === s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>{label}</button>
                ))}
              </div>
              <label className="sortbox" title="Ordenar">
                <Icon name="sort" />
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Ordenar">
                  <option value="recent">Recientes</option>
                  <option value="title">Título</option>
                  <option value="year">Año</option>
                </select>
              </label>
            </div>
            <label className="searchbox">
              <Icon name="search" />
              <input ref={search} type="search" placeholder="Buscar en la biblioteca" value={q} onChange={(e) => setQ(e.target.value)}
                     aria-label="Buscar" />
              {!q && <kbd>/</kbd>}
            </label>
          </div>
          {works === null ? <SkeletonGrid /> : shown.length === 0 ? (
            <div className="empty">
              <p className="display">{q ? "Nada con ese nombre" : works.length ? "Nada con estos filtros" : "Nada acá todavía"}</p>
              <p>{q ? "Probá con otra palabra, o el título original."
                : works.length ? <button className="link" onClick={() => { setTab("all"); setStatus("all"); }}>Ver todo</button>
                : <a href="#/subir">Subir una obra</a>}</p>
            </div>
          ) : (
            <div className="grid">
              {shown.map((w, i) => (
                <a key={w.id} className="tile" href={`#/w/${w.id}`} style={{ "--i": i } as React.CSSProperties}>
                  <div className="cover">
                    <span className="badge">{TYPE_LABEL[w.type]}</span>
                    {w.units > 0 && w.finished === w.units && <span className="done-badge" title="Terminada"><Icon name="check" /></span>}
                    {w.cover ? <Img src={thumb(w.cover, 320)} fallback={<span className="initial">{w.title.slice(0, 1)}</span>} />
                      : <span className="initial">{w.title.slice(0, 1)}</span>}
                    {w.finished > 0 && w.finished < w.units && <div className="bar"><div style={{ width: `${(w.finished / w.units) * 100}%` }} /></div>}
                  </div>
                  <strong>{w.title}</strong>
                  <span className="sub">{w.year ? `${w.year} · ` : ""}{unitsLabel(w)}</span>
                </a>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
