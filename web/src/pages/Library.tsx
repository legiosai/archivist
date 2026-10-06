import { useEffect, useMemo, useRef, useState } from "react";
import { AuthError, TYPE_LABEL, api, clock, unitPath, useQuery, type Progress, type WorkSummary, type WorkType } from "../api.ts";
import { Icon } from "../icons.tsx";
import { useProfiles } from "../profiles.tsx";
import { Header, Img, SkeletonGrid, thumb } from "./parts.tsx";

interface Latest extends Progress { work: WorkSummary }

const ORDER: WorkType[] = ["film", "series", "anime", "manga", "comic"];
const PLURAL: Record<WorkType, string> = { film: "Películas", series: "Series", anime: "Anime", manga: "Manga", comic: "Cómics" };
type Status = "all" | "reading" | "unstarted" | "finished";
type Sort = "recent" | "title" | "year";
const STATUS: [Status, string][] = [["all", "Todas"], ["reading", "En curso"], ["unstarted", "Sin empezar"], ["finished", "Terminadas"]];

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
const sorted = (list: WorkSummary[]) => [...list].sort((a, b) => (b.last?.updatedAt ?? "").localeCompare(a.last?.updatedAt ?? "")
  || a.title.localeCompare(b.title, "es"));

/** Where someone stopped, as a picture: the frame at that second, or the page they reached. */
function stoppedAt(l: Latest): string {
  const base = unitPath(l.workId, l.unitKey);
  return l.work.kind === "video" ? `${base}/frame?t=${Math.floor(l.position / 10) * 10}&w=640` : `${base}/pages/${Math.max(1, l.position)}?w=480`;
}

/**
 * A work as a card. Videos without a real poster show wide (a frame cropped tall says little),
 * the rest tall like a cover.
 */
function Card({ w, wide, i, badge = false }: { w: WorkSummary; wide: boolean; i: number; badge?: boolean }) {
  const src = wide ? w.backdrop ?? w.cover : w.cover;
  const done = w.units > 0 && w.finished === w.units;
  const share = w.last && !w.last.finished ? pct(w.last) : w.finished > 0 && !done ? (w.finished / w.units) * 100 : 0;
  return (
    <a className={`wcard ${wide ? "wide" : "tall"}`} href={`#/w/${w.id}`} style={{ "--i": i } as React.CSSProperties}>
      <div className="card-art">
        {src ? <Img src={thumb(src, wide ? 640 : 320)} fallback={<span className="initial">{w.title.slice(0, 1)}</span>} />
          : <span className="initial">{w.title.slice(0, 1)}</span>}
        {badge && <span className="badge">{TYPE_LABEL[w.type]}</span>}
        {done && <span className="done-badge" title="Terminada"><Icon name="check" /></span>}
        {share > 0 && <div className="bar"><div style={{ width: `${share}%` }} /></div>}
        {wide && <span className="card-title-over">{w.title}</span>}
      </div>
      {!wide && <strong>{w.title}</strong>}
      <span className="sub">{w.year ? `${w.year} · ` : ""}{unitsLabel(w)}</span>
    </a>
  );
}

/** Wide when most of the row's videos have no poster of their own. */
const wideRow = (list: WorkSummary[]) => list.length > 0 && list.every((w) => w.kind === "video")
  && list.filter((w) => w.poster === "auto").length * 2 >= list.length;

function useLibrary(onAuth: () => void) {
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [latest, setLatest] = useState<Latest[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api<{ works: WorkSummary[] }>("/api/v1/works"), api<{ latest: Latest[] }>("/api/v1/progress")])
      .then(([w, p]) => { setWorks(w.works); setLatest(p.latest); })
      .catch((e) => (e instanceof AuthError ? onAuth() : setError(String(e.message))));
  }, [onAuth]);
  return { works, latest, error };
}

function Hero({ hero, works, name }: { hero: Latest | undefined; works: WorkSummary[]; name: string | undefined }) {
  if (!hero) {
    const pool = works.filter((w) => statusOf(w) !== "finished" && w.units > 0);
    const surprise = () => {
      const w = pool[Math.floor(Math.random() * pool.length)];
      if (w) window.location.hash = `#/w/${w.id}`;
    };
    return (
      <section className="stage-hero empty-hero">
        <div className="stage-text">
          <span className="eyebrow">{works.length ? (name ? `Hola, ${name}` : "Hola") : "Tu biblioteca"}</span>
          <h1>{works.length ? `¿Qué ${works.some((w) => w.kind === "pages") ? "leemos" : "vemos"} hoy?` : "Todo lo que tenés para leer y ver, en un lugar."}</h1>
          <p className="meta">{works.length ? `${works.length} ${works.length === 1 ? "obra espera" : "obras esperan"}. Lo que empieces queda guardado en tu perfil.` : "Y nunca se olvida dónde quedaste."}</p>
          <div className="row">
            {pool.length > 0 && <button className="primary lg" onClick={surprise}><Icon name="play" /> Sorprendeme</button>}
            <a className="btn lg" href="#/subir"><Icon name="upload" /> {works.length ? "Subir más" : "Subir una obra"}</a>
          </div>
        </div>
      </section>
    );
  }
  const w = hero.work;
  const video = w.kind === "video";
  return (
    <section className={`stage-hero ${w.backdrop ? "" : "bookish"}`}>
      <div className="stage-art" aria-hidden="true">
        {w.backdrop ? <Img src={thumb(w.backdrop, 1280)} /> : w.cover && <div className="stage-blur" style={{ backgroundImage: `url("${thumb(w.cover, 480)}")` }} />}
      </div>
      {!w.backdrop && w.cover && <Img className="stage-cover" src={thumb(w.cover, 480)} />}
      <div className="stage-text">
        <span className="eyebrow">Seguí {video ? "viendo" : "leyendo"}{name ? `, ${name}` : ""}</span>
        <h1>{w.title}</h1>
        <p className="meta">{[w.year, TYPE_LABEL[w.type], whereText(hero)].filter(Boolean).join(" · ")}</p>
        {!hero.finished && <div className="progress-line"><div className="bar"><div style={{ width: `${pct(hero)}%` }} /></div></div>}
        <div className="row">
          <a className="btn primary lg" href={`#/${video ? "v" : "r"}/${hero.workId}/${hero.unitKey}`}>
            <Icon name={video ? "play" : "book"} /> Seguir
          </a>
          <a className="btn lg glass" href={`#/w/${hero.workId}`}>Detalles</a>
        </div>
      </div>
    </section>
  );
}

export function Library({ onAuth }: { onAuth: () => void }) {
  const { works, latest, error } = useLibrary(onAuth);
  const { me } = useProfiles();
  const keepGoing = latest.filter((l) => !(l.finished && l.work.finished >= l.work.units)).slice(0, 12);
  const byType = useMemo(() => ORDER.map((t) => [t, sorted((works ?? []).filter((w) => w.type === t))] as const).filter(([, l]) => l.length), [works]);

  return (
    <>
      <Header active="library" />
      {works === null ? <div className="skeleton stage-skel" /> : <Hero hero={keepGoing[0]} works={works} name={me?.name} />}
      <main className="home">
        {error && <p className="notice bad">{error}</p>}

        {keepGoing.length > 1 && (
          <section className="shelf-block">
            <div className="shelf-head"><h2>Seguir</h2></div>
            <div className="rail wide">
              {keepGoing.slice(1).map((l, i) => (
                <a key={l.workId} className={`resume-card ${l.work.kind === "video" ? "" : "pages"}`} href={`#/${l.work.kind === "video" ? "v" : "r"}/${l.workId}/${l.unitKey}`}
                   style={{ "--i": i } as React.CSSProperties}>
                  <div className="resume-art">
                    {l.work.kind !== "video" && l.work.cover && <div className="resume-blur" style={{ backgroundImage: `url("${thumb(l.work.cover, 160)}")` }} />}
                    <Img src={stoppedAt(l)} fallback={l.work.cover ? <Img src={thumb(l.work.cover, 320)} /> : null} />
                    <span className="play"><Icon name={l.work.kind === "video" ? "play" : "book"} /></span>
                    {!l.finished && <div className="bar"><div style={{ width: `${pct(l)}%` }} /></div>}
                  </div>
                  <strong>{l.work.title}</strong>
                  <span className="sub">{whereText(l)}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {works === null ? <SkeletonGrid n={6} /> : byType.map(([t, list]) => {
          const wide = wideRow(list);
          return (
            <section key={t} className="shelf-block">
              <div className="shelf-head">
                <h2>{PLURAL[t]} <span className="count">{list.length}</span></h2>
                <a className="see-all" href={`#/todo?tipo=${t}`}>Ver todo <Icon name="next" /></a>
              </div>
              <div className={`rail ${wide ? "wide" : "tall"}`}>
                {list.slice(0, 20).map((w, i) => <Card key={w.id} w={w} wide={wide} i={i} />)}
              </div>
            </section>
          );
        })}
      </main>
    </>
  );
}

/** Every work in one grid, with type, state, order and a search. */
export function Catalog({ onAuth }: { onAuth: () => void }) {
  const { works, error } = useLibrary(onAuth);
  const asked = useQuery("tipo") as WorkType | null;
  const [tab, setTab] = useState<WorkType | "all">(asked && ORDER.includes(asked) ? asked : "all");
  const [status, setStatus] = useState<Status>(() => remembered("status", "all"));
  const [sort, setSort] = useState<Sort>(() => remembered("sort", "recent"));
  const [q, setQ] = useState("");
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { localStorage.setItem("status", status); localStorage.setItem("sort", sort); } catch { /* private mode */ }
  }, [status, sort]);

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
    return sorted(list);
  }, [works, tab, status, sort, q]);
  const units = (works ?? []).reduce((n, w) => n + w.units, 0);
  const finished = (works ?? []).reduce((n, w) => n + w.finished, 0);

  return (
    <>
      <Header active="library" />
      <main>
        <div className="page-head">
          <div>
            <span className="eyebrow">Biblioteca</span>
            <h1>{tab === "all" ? "Todo" : PLURAL[tab]}</h1>
            {works && <p className="faint">{works.length} {works.length === 1 ? "obra" : "obras"} · {units} tomos y episodios · {finished} terminados</p>}
          </div>
          <label className="searchbox">
            <Icon name="search" />
            <input ref={search} type="search" placeholder="Filtrar por título o año" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filtrar" />
            {!q && <kbd>/</kbd>}
          </label>
        </div>
        {error && <p className="notice bad">{error}</p>}
        <div className="toolbar compact">
          <div className="tabs" role="tablist">
            {(["all", ...ORDER] as const).filter((t) => t === "all" || counts[t]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                {t === "all" ? "Todo" : PLURAL[t]} <span className="count">{counts[t] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="row selects">
            <label className="sortbox" title="Estado">
              <Icon name="sliders" />
              <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Estado">
                {STATUS.map(([s, label]) => <option key={s} value={s}>{label}</option>)}
              </select>
            </label>
            <label className="sortbox" title="Ordenar">
              <Icon name="sort" />
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Ordenar">
                <option value="recent">Recientes</option>
                <option value="title">Título</option>
                <option value="year">Año</option>
              </select>
            </label>
          </div>
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
            {shown.map((w, i) => <Card key={w.id} w={w} wide={false} i={i} badge={tab === "all"} />)}
          </div>
        )}
      </main>
    </>
  );
}
