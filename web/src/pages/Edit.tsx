import { useEffect, useRef, useState } from "react";
import { AuthError, api, unitPath, type Candidate, type WorkDetail } from "../api.ts";
import { Icon } from "../icons.tsx";
import { Img, thumb } from "./parts.tsx";

/** Moments to offer as a poster: spread over the film, past the opening and before the credits. */
const MOMENTS = [0.06, 0.12, 0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76, 0.84, 0.9];

const SOURCE = { tmdb: "TMDB", anilist: "AniList" } as const;

function posterSource(w: WorkDetail): string {
  if (w.poster === "file") return "Tu imagen";
  if (w.poster === "metadata") return w.details.source ? `De ${SOURCE[w.details.source]}` : "Descargada";
  return w.kind === "video" ? "Un cuadro del video, elegido solo" : "La primera página";
}

async function send(path: string, init: RequestInit): Promise<WorkDetail> {
  const r = await fetch(path, { credentials: "same-origin", ...init });
  if (r.status === 401) throw new AuthError("token required");
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.statusText);
  return (await r.json()) as WorkDetail;
}

function Poster({ work, onChange, onAuth }: { work: WorkDetail; onChange: (w: WorkDetail) => void; onAuth: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const video = work.unitList.find((u) => u.format === "video");
  const base = `/api/v1/works/${work.id}/poster`;

  async function run(what: string, job: () => Promise<WorkDetail>) {
    setBusy(what);
    setError("");
    try {
      onChange(await job());
    } catch (e) {
      if (e instanceof AuthError) onAuth(); else setError(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="edit-poster">
      <div className="edit-current">
        {work.cover ? <Img className="edit-cover" src={thumb(work.cover, 320)} /> : <div className="edit-cover placeholder">{work.title.slice(0, 1)}</div>}
        <div>
          <span className="eyebrow">Portada</span>
          <p className="edit-source">{posterSource(work)}</p>
          <div className="row">
            <button className="primary" disabled={!!busy} onClick={() => file.current?.click()}>
              <Icon name="image" /> {busy === "upload" ? "Subiendo…" : "Subir una imagen"}
            </button>
            {work.poster === "file" && (
              <button disabled={!!busy} onClick={() => void run("remove", () => send(base, { method: "DELETE" }))}>
                <Icon name="trash" /> Quitar la mía
              </button>
            )}
          </div>
          <p className="faint small">JPEG, PNG o WebP. Se guarda como <code>poster</code> en la carpeta de la obra, junto a sus archivos.</p>
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void run("upload", () => send(base, { method: "PUT", body: f }));
          }} />
        </div>
      </div>
      {video && (
        <>
          <h3 className="edit-sub">O un cuadro del video</h3>
          <div className="moments">
            {MOMENTS.map((at) => (
              <button key={at} className={`moment ${busy === `frame${at}` ? "busy" : ""}`} disabled={!!busy} title="Usar este cuadro"
                      onClick={() => void run(`frame${at}`, () => send(`${base}/frame`, { method: "POST", headers: { "content-type": "application/json" },
                        body: JSON.stringify({ at, unit: video.key }) }))}>
                <Img src={`${unitPath(work.id, video.key)}/frame?at=${at}&w=320`} />
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="notice bad">{error}</p>}
    </div>
  );
}

function Data({ work, onChange, onAuth }: { work: WorkDetail; onChange: (w: WorkDetail) => void; onAuth: () => void }) {
  const d = work.details;
  const [q, setQ] = useState(work.originalTitle || work.title);
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function guard(job: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await job(); } catch (e) { if (e instanceof AuthError) onAuth(); else setError(String((e as Error).message)); } finally { setBusy(false); }
  }
  const search = () => guard(async () => {
    setResults((await api<{ results: Candidate[] }>(`/api/v1/works/${work.id}/meta/search?q=${encodeURIComponent(q)}`)).results);
  });
  const pick = (extId: string | null) => guard(async () => {
    onChange(await api<WorkDetail>(`/api/v1/works/${work.id}/meta`, { method: "PUT", body: JSON.stringify({ extId }) }));
    setResults(null);
  });
  const again = () => guard(async () => onChange(await api<WorkDetail>(`/api/v1/works/${work.id}/meta/refresh`, { method: "POST" })));

  if (!d.lookup) {
    return (
      <div className="edit-data">
        <p>Para traer la sinopsis, los géneros y una portada, archivist puede buscar la obra en
          {work.type === "manga" || work.type === "comic" ? " AniList" : " TMDB (películas y series) o AniList (anime y manga)"}.
          Está apagado: se activa en el servidor con <code>ARCHIVIST_METADATA</code>{work.type === "comic" ? ", y para cómics no hay fuente." : "."}</p>
        <p className="faint small">También podés escribirlos a mano en el yaml de la obra: <code>overview</code>, <code>genres</code> y
          <code> director</code>, <code>author</code> o <code>studio</code>. Eso siempre tiene prioridad.</p>
      </div>
    );
  }

  const name = SOURCE[d.lookup];
  return (
    <div className="edit-data">
      <div className="match">
        {d.match === "none" || !d.source ? (
          <p><strong>Sin datos de {name}.</strong> {d.match === "none" ? "No hubo una coincidencia segura, o dijiste que no era ninguna." : "Todavía no se buscó."}</p>
        ) : (
          <p>
            <strong>{d.remoteTitle ?? work.title}</strong> en {name}
            <span className="faint"> · {d.match === "id" ? "por el id del yaml" : d.match === "owner" ? "elegida por vos" : "encontrada por título y año"}</span>
            {d.url && <> · <a href={d.url} target="_blank" rel="noreferrer noopener">ver <Icon name="external" className="icon tiny" /></a></>}
          </p>
        )}
        <div className="row">
          <button disabled={busy} onClick={() => void again()}><Icon name="refresh" /> Buscar de nuevo</button>
          {d.source && <button disabled={busy} onClick={() => void pick(null)}>No es esta</button>}
        </div>
      </div>
      <form className="searchrow" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar en ${name}`} aria-label={`Buscar en ${name}`} />
        <button type="submit" className="primary" disabled={busy || !q.trim()}><Icon name="search" /> Buscar</button>
      </form>
      {results && results.length === 0 && <p className="faint">Nada con ese nombre en {name}.</p>}
      {results && results.length > 0 && (
        <ul className="candidates">
          {results.map((c) => (
            <li key={c.extId}>
              <button className={`candidate ${c.extId === d.extId ? "on" : ""}`} disabled={busy} onClick={() => void pick(c.extId)}>
                {c.posterUrl ? <Img className="cand-poster" src={`/api/v1/meta/thumb?u=${encodeURIComponent(c.posterUrl)}`}
                  fallback={<span className="cand-poster placeholder" />} /> : <span className="cand-poster placeholder" />}
                <span className="cand-text">
                  <strong>{c.title ?? "Sin título"}{c.year ? <span className="faint"> · {c.year}</span> : null}</strong>
                  {c.overview && <span>{c.overview}</span>}
                </span>
                {c.extId === d.extId && <Icon name="check" className="icon tick" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="notice bad">{error}</p>}
      {d.lookup === "tmdb" && <p className="faint small attribution">Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.</p>}
    </div>
  );
}

/** The editor over a work's page: its poster, and which TMDB or AniList entry it is. */
export function EditSheet({ work, onChange, onClose, onAuth }: { work: WorkDetail; onChange: (w: WorkDetail) => void; onClose: () => void; onAuth: () => void }) {
  const [tab, setTab] = useState<"poster" | "data">("poster");
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="sheet-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Editar ${work.title}`}>
        <div className="sheet-head">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "poster"} className={tab === "poster" ? "on" : ""} onClick={() => setTab("poster")}>Portada</button>
            <button role="tab" aria-selected={tab === "data"} className={tab === "data" ? "on" : ""} onClick={() => setTab("data")}>Datos</button>
          </div>
          <button className="icon-only" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button>
        </div>
        {tab === "poster" ? <Poster work={work} onChange={onChange} onAuth={onAuth} /> : <Data work={work} onChange={onChange} onAuth={onAuth} />}
      </div>
    </div>
  );
}
