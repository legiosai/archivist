import { useEffect, useState } from "react";
import { AuthError, TYPE_LABEL, api, type WorkDetail, type WorkSummary, type WorkType } from "../api.ts";
import { Header } from "./parts.tsx";

const CHUNK = 8 * 1024 * 1024;

interface Item {
  file: File;
  path: string;
  sent: number;
  state: "waiting" | "sending" | "done" | "error";
  error?: string;
}

/** The path inside the work: for a folder upload, the last folder and the name ("Vol 1/001.jpg"). */
function pathOf(f: File): string {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  return rel.split("/").slice(-2).join("/");
}

const resumeKey = (workId: string, f: File, path: string) => `up:${workId}:${path}:${f.size}:${f.lastModified}`;

async function send(workId: string, item: Item, onProgress: (n: number) => void): Promise<void> {
  const key = resumeKey(workId, item.file, item.path);
  let id = localStorage.getItem(key);
  let offset = 0;
  if (id) {
    const h = await fetch(`/api/v1/uploads/${id}`, { method: "HEAD", credentials: "same-origin" });
    if (h.ok) offset = Number(h.headers.get("upload-offset") ?? 0);
    else id = null;
  }
  if (!id) {
    const r = await api<{ id: string }>("/api/v1/uploads", { method: "POST",
      body: JSON.stringify({ workId, path: item.path, size: item.file.size }) });
    id = r.id;
    try { localStorage.setItem(key, id); } catch { /* private mode */ }
  }
  let failures = 0;
  while (offset < item.file.size) {
    const body = item.file.slice(offset, Math.min(item.file.size, offset + CHUNK));
    try {
      const r = await fetch(`/api/v1/uploads/${id}`, { method: "PATCH", credentials: "same-origin",
        headers: { "upload-offset": String(offset), "content-type": "application/offset+octet-stream" }, body });
      if (r.status === 401) throw new AuthError("token required");
      if (r.status === 409) {             // the server has a different offset: ask and continue from there
        const h = await fetch(`/api/v1/uploads/${id}`, { method: "HEAD", credentials: "same-origin" });
        offset = Number(h.headers.get("upload-offset") ?? offset);
        continue;
      }
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.statusText);
      offset = Number(r.headers.get("upload-offset") ?? offset + body.size);
      failures = 0;
      onProgress(offset);
    } catch (e) {
      if (e instanceof AuthError || ++failures > 5) throw e;
      await new Promise((res) => setTimeout(res, 1000 * 2 ** failures));
      const h = await fetch(`/api/v1/uploads/${id}`, { method: "HEAD", credentials: "same-origin" }).catch(() => null);
      if (h?.ok) offset = Number(h.headers.get("upload-offset") ?? offset);
    }
  }
  localStorage.removeItem(key);
}

export function Upload({ preset, onAuth }: { preset: string | null; onAuth: () => void }) {
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [workId, setWorkId] = useState(preset ?? "");
  const [creating, setCreating] = useState(!preset);
  const [form, setForm] = useState({ title: "", type: "manga" as WorkType, year: "" });
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api<{ works: WorkSummary[] }>("/api/v1/works").then((r) => { setWorks(r.works); if (!preset && r.works.length) setCreating(false); })
      .catch((e) => (e instanceof AuthError ? onAuth() : setMessage(String(e.message))));
  }, [preset, onAuth]);

  function pick(list: FileList | null) {
    if (!list) return;
    const added = [...list].filter((f) => !f.name.startsWith(".")).map((file) => ({ file, path: pathOf(file), sent: 0, state: "waiting" as const }));
    setItems((cur) => [...cur, ...added]);
  }

  async function start() {
    setMessage("");
    let target = workId;
    try {
      if (creating) {
        const w = await api<WorkDetail>("/api/v1/works", { method: "POST",
          body: JSON.stringify({ title: form.title, type: form.type, year: Number(form.year) || undefined }) });
        target = w.id;
        setWorks((cur) => [...cur.filter((x) => x.id !== w.id), w]);
        setWorkId(w.id);
        setCreating(false);
      }
      if (!target) { setMessage("Elegí una obra o creá una nueva."); return; }
      setBusy(true);
      for (let i = 0; i < items.length; i++) {
        if (items[i]!.state === "done") continue;
        setItems((cur) => cur.map((it, j) => (j === i ? { ...it, state: "sending" } : it)));
        try {
          await send(target, items[i]!, (n) => setItems((cur) => cur.map((it, j) => (j === i ? { ...it, sent: n } : it))));
          setItems((cur) => cur.map((it, j) => (j === i ? { ...it, state: "done", sent: it.file.size } : it)));
        } catch (e) {
          if (e instanceof AuthError) { onAuth(); return; }
          setItems((cur) => cur.map((it, j) => (j === i ? { ...it, state: "error", error: String((e as Error).message) } : it)));
        }
      }
      setMessage("Listo. Si algo falló, se puede volver a subir y sigue desde donde quedó.");
    } catch (e) {
      if (e instanceof AuthError) onAuth(); else setMessage(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  const total = items.reduce((n, it) => n + it.file.size, 0);
  const sent = items.reduce((n, it) => n + it.sent, 0);
  const current = works.find((w) => w.id === workId);
  const accepts = current?.kind === "video" || (creating && ["film", "series", "anime"].includes(form.type))
    ? "video/*,.mkv,.srt,.vtt,.ass" : "image/*,.cbz,.zip,.pdf";

  return (
    <>
      <Header active="upload" />
      <main className="narrow">
        <h1>Subir</h1>
        <p className="faint small">Solo obras que tenés legalmente. archivist no descarga nada: lee lo que subís.</p>
        <div className="card">
          <div className="row">
            <label className="check"><input type="radio" checked={!creating} onChange={() => setCreating(false)} disabled={!works.length} /> A una obra</label>
            <label className="check"><input type="radio" checked={creating} onChange={() => setCreating(true)} /> Obra nueva</label>
          </div>
          {creating ? (
            <>
              <label htmlFor="title">Título</label>
              <input id="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Berserk" />
              <div className="row">
                <div>
                  <label htmlFor="type">Tipo</label>
                  <select id="type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as WorkType })}>
                    {(Object.keys(TYPE_LABEL) as WorkType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="year">Año</label>
                  <input id="year" inputMode="numeric" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
                </div>
              </div>
            </>
          ) : (
            <select value={workId} onChange={(e) => setWorkId(e.target.value)} aria-label="Obra">
              <option value="">Elegir…</option>
              {works.map((w) => <option key={w.id} value={w.id}>{w.title} · {TYPE_LABEL[w.type]}</option>)}
            </select>
          )}
        </div>
        <div className="card">
          <label>Archivos</label>
          <input type="file" multiple accept={accepts} onChange={(e) => pick(e.target.files)} />
          <label>o una carpeta entera</label>
          <input type="file" multiple onChange={(e) => pick(e.target.files)} {...{ webkitdirectory: "", directory: "" }} />
          <p className="faint small">
            Manga y cómics: un CBZ, ZIP o PDF por tomo, o una carpeta de imágenes por tomo. Series: un archivo por episodio con S01E02 en el nombre; los .srt al lado.
          </p>
        </div>
        {items.length > 0 && (
          <div className="card">
            <div className="spread"><strong>{items.length} archivo(s)</strong><span className="faint small">{Math.round((sent / Math.max(1, total)) * 100)} %</span></div>
            <div className="bar"><div style={{ width: `${(sent / Math.max(1, total)) * 100}%` }} /></div>
            <ul className="files">
              {items.map((it, i) => (
                <li key={i} className={it.state}>
                  <span>{it.path}</span>
                  <span className="faint small">{it.state === "error" ? it.error : it.state === "done" ? "listo" : `${Math.round((it.sent / it.file.size) * 100)} %`}</span>
                </li>
              ))}
            </ul>
            <div className="row">
              <button className="primary" onClick={start} disabled={busy}>{busy ? "Subiendo…" : "Subir"}</button>
              {!busy && <button onClick={() => setItems([])}>Vaciar</button>}
              {workId && !busy && items.every((it) => it.state === "done") && <a className="btn" href={`#/w/${workId}`}>Ver la obra</a>}
            </div>
          </div>
        )}
        {message && <p className="notice">{message}</p>}
      </main>
    </>
  );
}
