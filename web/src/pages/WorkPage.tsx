import { useEffect, useState } from "react";
import { AuthError, TYPE_LABEL, api, clock, minutes, unitPath, type UnitView, type WorkDetail } from "../api.ts";
import { Icon } from "../icons.tsx";
import { EditSheet } from "./Edit.tsx";
import { Header, Img, thumb } from "./parts.tsx";

/** Who made it, by what the work is: a film's director, a series' creators, an anime's studio, a book's author. */
const CREDIT: Record<WorkDetail["type"], string> = { film: "Dirección", series: "Creación", anime: "Estudio", manga: "Autoría", comic: "Autoría" };

function Overview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 320;
  return (
    <div className="overview">
      <p className={long && !open ? "clamped" : ""}>{text}</p>
      {long && <button className="link" onClick={() => setOpen(!open)}>{open ? "Menos" : "Más"}</button>}
    </div>
  );
}

export function unitHref(work: WorkDetail, u: UnitView): string {
  return `#/${u.format === "video" ? "v" : "r"}/${work.id}/${u.key}`;
}

/** Where "continue" goes: the unit last touched if unfinished, else the next one, else the first. */
export function continueUnit(work: WorkDetail): UnitView | null {
  const units = work.unitList;
  if (!units.length) return null;
  const touched = units.filter((u) => u.progress).sort((a, b) => b.progress!.updatedAt.localeCompare(a.progress!.updatedAt))[0];
  if (!touched) return units[0]!;
  if (!touched.progress!.finished) return touched;
  return units[units.indexOf(touched) + 1] ?? touched;
}

function progressText(work: WorkDetail, u: UnitView): string {
  const p = u.progress;
  if (!p) return "";
  if (p.finished) return "terminado";
  return work.kind === "video" ? `${clock(p.position)} / ${clock(p.total)}` : `pág. ${p.position}/${p.total}`;
}

function unitThumb(work: WorkDetail, u: UnitView): string {
  const base = unitPath(work.id, u.key);
  return u.format === "video" ? `${base}/frame?at=0.12&w=480` : `${base}/pages/1?w=320`;
}

/** The number on a volume's card: its volume, else its episode, else its place. */
function unitNumber(u: UnitView, i: number): string {
  return String(u.volume ?? u.episode ?? i + 1);
}

export function WorkPage({ id, onAuth }: { id: string; onAuth: () => void }) {
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [error, setError] = useState("");
  const [season, setSeason] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    api<WorkDetail>(`/api/v1/works/${id}`).then(setWork)
      .catch((e) => (e instanceof AuthError ? onAuth() : setError(String(e.message))));
  }, [id, onAuth]);
  if (error) return <><Header /><main><p className="notice bad">{error}</p></main></>;
  if (!work) return (
    <><Header /><main><div className="work-head"><div className="skeleton poster" /><div><div className="skeleton line" /><div className="skeleton line" /></div></div></main></>
  );

  const next = continueUnit(work);
  const seasons = [...new Set(work.unitList.map((u) => u.season ?? 0))].sort((a, b) => a - b);
  const shownSeason = season ?? next?.season ?? seasons[0] ?? 0;
  const units = seasons.length > 1 ? work.unitList.filter((u) => (u.season ?? 0) === shownSeason) : work.unitList;
  const video = work.kind === "video";
  const started = next?.progress && !next.progress.finished;
  const share = work.units ? (work.finished / work.units) * 100 : 0;
  const d = work.details;

  return (
    <>
      {work.cover && <div className="backdrop"><div style={{ backgroundImage: `url("${thumb(work.cover, 480)}")` }} /></div>}
      <Header />
      <main>
        <div className="work-head">
          {work.cover ? <Img className="work-cover" src={thumb(work.cover, 480)} fallback={<div className="work-cover placeholder">{work.title.slice(0, 1)}</div>} />
            : <div className="work-cover placeholder">{work.title.slice(0, 1)}</div>}
          <div>
            <span className="eyebrow">{TYPE_LABEL[work.type]}</span>
            <h1>{work.title}</h1>
            {work.originalTitle && work.originalTitle !== work.title && <p className="original">{work.originalTitle}</p>}
            <div className="chips">
              {work.year && <span className="chip">{work.year}</span>}
              {d.runtime && <span className="chip"><Icon name="clock" className="icon tiny" />{minutes(d.runtime)}{work.type !== "film" && video ? " por episodio" : ""}</span>}
              <span className="chip">{work.units} {video ? (work.type === "film" ? "archivo" : "episodios") : "tomos"}</span>
              {seasons.length > 1 && <span className="chip">{seasons.length} temporadas</span>}
              {work.reading && !video && <span className="chip">{work.reading === "rtl" ? "Derecha a izquierda" : work.reading === "vertical" ? "Vertical" : "Izquierda a derecha"}</span>}
            </div>
            {d.genres.length > 0 && <p className="genres">{d.genres.join(" · ")}</p>}
            {d.credits.length > 0 && <p className="credits"><span className="faint">{CREDIT[work.type]}</span> {d.credits.join(", ")}</p>}
            {d.overview && <Overview text={d.overview} />}
            {work.units > 0 && (
              <div className="progress-line">
                <div className="spread"><span>{work.finished} de {work.units} {video ? "vistos" : "leídos"}</span><span>{Math.round(share)} %</span></div>
                <div className="bar"><div style={{ width: `${share}%` }} /></div>
              </div>
            )}
            <div className="row">
              {next && (
                <a className="btn primary lg" href={unitHref(work, next)}>
                  <Icon name={video ? "play" : "book"} />
                  {started ? "Seguir" : video ? "Ver" : "Leer"} · {next.label}
                </a>
              )}
              <a className="btn" href={`#/subir/${work.id}`}><Icon name="upload" /> Subir archivos</a>
              <button onClick={() => setEditing(true)}><Icon name="pencil" /> Portada y datos</button>
            </div>
            {d.source && (
              <p className="faint small source-line">Datos de <a href={d.url ?? "#"} target="_blank" rel="noreferrer noopener">{d.source === "tmdb" ? "TMDB" : "AniList"}</a></p>
            )}
          </div>
        </div>

        {work.unitList.length === 0 && (
          <div className="empty"><p className="display">Todavía sin archivos</p><p><a href={`#/subir/${work.id}`}>Subir los primeros</a></p></div>
        )}
        {seasons.length > 1 && (
          <div className="tabs season-tabs" role="tablist">
            {seasons.map((s) => (
              <button key={s} role="tab" aria-selected={s === shownSeason} className={s === shownSeason ? "on" : ""} onClick={() => setSeason(s)}>
                {s ? `Temporada ${s}` : "Extras"}
              </button>
            ))}
          </div>
        )}
        {work.unitList.length > 0 && seasons.length <= 1 && <h2>{video ? (work.type === "film" ? "Película" : "Episodios") : "Tomos"}</h2>}
        <ul className={`units ${video ? "episodes" : "volumes"}`}>
          {units.map((u, i) => (
            <li key={u.key}>
              <a className={`unit ${next?.key === u.key ? "current" : ""}`} href={unitHref(work, u)} style={{ "--i": i } as React.CSSProperties}>
                <div className="thumb">
                  <Img src={unitThumb(work, u)} />
                  {!video && <span className="num">{unitNumber(u, i)}</span>}
                  {u.progress?.finished && <span className="done-badge" title="Terminado"><Icon name="check" /></span>}
                  <span className="play"><span><Icon name={video ? "play" : "book"} /></span></span>
                  {u.progress && !u.progress.finished && (
                    <div className="bar"><div style={{ width: `${(u.progress.position / Math.max(1, u.progress.total)) * 100}%` }} /></div>
                  )}
                </div>
                <div className="meta"><span>{u.label}</span><span>{progressText(work, u)}</span></div>
              </a>
            </li>
          ))}
        </ul>
      </main>
      {editing && <EditSheet work={work} onChange={setWork} onClose={() => setEditing(false)} onAuth={onAuth} />}
    </>
  );
}
