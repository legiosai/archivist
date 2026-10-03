import { useEffect, useState } from "react";
import { AuthError, TYPE_LABEL, api, clock, type UnitView, type WorkDetail } from "../api.ts";
import { Header } from "./parts.tsx";

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
  return work.kind === "video" ? `${clock(p.position)} de ${clock(p.total)}` : `página ${p.position} de ${p.total}`;
}

export function WorkPage({ id, onAuth }: { id: string; onAuth: () => void }) {
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<WorkDetail>(`/api/v1/works/${id}`).then(setWork)
      .catch((e) => (e instanceof AuthError ? onAuth() : setError(String(e.message))));
  }, [id, onAuth]);
  if (error) return <><Header /><main><p className="bad">{error}</p></main></>;
  if (!work) return <><Header /><main><p className="faint">Cargando…</p></main></>;
  const next = continueUnit(work);
  const seasons = new Map<number, UnitView[]>();
  for (const u of work.unitList) {
    const k = u.season ?? 0;
    seasons.set(k, [...(seasons.get(k) ?? []), u]);
  }
  return (
    <>
      <Header />
      <main>
        <div className="work-head">
          {work.cover && <img className="work-cover" src={work.cover} alt="" />}
          <div>
            <span className="eyebrow">{TYPE_LABEL[work.type]}{work.year ? ` · ${work.year}` : ""}</span>
            <h1>{work.title}</h1>
            {work.originalTitle && work.originalTitle !== work.title && <p className="faint">{work.originalTitle}</p>}
            <p className="faint small">{work.finished} de {work.units} {work.kind === "video" ? "terminados" : "tomos leídos"}</p>
            <div className="row">
              {next && (
                <a className="btn primary" href={unitHref(work, next)}>
                  {next.progress && !next.progress.finished ? "Seguir" : work.kind === "video" ? "Ver" : "Leer"} · {next.label}
                </a>
              )}
              <a className="btn" href={`#/subir/${work.id}`}>Subir archivos</a>
            </div>
          </div>
        </div>
        {work.unitList.length === 0 && <p className="faint">Todavía no tiene archivos. <a href={`#/subir/${work.id}`}>Subir</a>.</p>}
        {[...seasons.entries()].map(([season, units]) => (
          <section key={season}>
            {season > 0 && seasons.size > 1 && <h2>Temporada {season}</h2>}
            <ul className="units">
              {units.map((u) => (
                <li key={u.key} className={u.progress?.finished ? "done" : ""}>
                  <a href={unitHref(work, u)}>
                    <span>{u.label}</span>
                    <span className="faint small">{progressText(work, u)}</span>
                  </a>
                  {u.progress && !u.progress.finished && (
                    <div className="bar"><div style={{ width: `${(u.progress.position / Math.max(1, u.progress.total)) * 100}%` }} /></div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
