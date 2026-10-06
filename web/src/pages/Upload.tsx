import { useEffect, useRef, useState } from "react";
import { AuthError, TYPE_LABEL, api, type WorkDetail, type WorkSummary, type WorkType } from "../api.ts";
import { Icon } from "../icons.tsx";
import { Header } from "./parts.tsx";

const CHUNK = 8 * 1024 * 1024;

interface Item {
  file: File;
  path: string;
  sent: number;
  state: "waiting" | "sending" | "done" | "error";
  error?: string;
}

/** The path inside the work: for a folder, the last folder and the name ("Vol 1/001.jpg"). */
function pathOf(f: File, rel?: string): string {
  const full = rel || (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  return full.split("/").filter(Boolean).slice(-2).join("/");
}

const resumeKey = (workId: string, f: File, path: string) => `up:${workId}:${path}:${f.size}:${f.lastModified}`;

export function size(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString("es-AR", { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}

function eta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return "menos de un minuto";
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Every file in what was dropped, folders included (their path inside kept). */
async function dropped(dt: DataTransfer): Promise<{ file: File; rel: string }[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return [...dt.files].map((file) => ({ file, rel: file.name }));
  const out: { file: File; rel: string }[] = [];
  const walk = async (e: FileSystemEntry, prefix: string): Promise<void> => {
    if (e.isFile) {
      const file = await new Promise<File>((ok, ko) => (e as FileSystemFileEntry).file(ok, ko));
      out.push({ file, rel: `${prefix}${e.name}` });
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, ko) => reader.readEntries(ok, ko));
        if (!batch.length) break;
        for (const c of batch) await walk(c, `${prefix}${e.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}

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
  onProgress(offset);
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

/** What a file is, by its name: for the list's icon and the check of what the work takes. */
function kindOf(path: string): "video" | "pages" | "image" | "subtitle" | "other" {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mkv", "webm", "mov", "m4v", "avi"].includes(ext)) return "video";
  if (["cbz", "zip", "pdf"].includes(ext)) return "pages";
  if (["jpg", "jpeg", "png", "webp", "avif", "gif"].includes(ext)) return "image";
  if (["srt", "vtt", "ass", "ssa"].includes(ext)) return "subtitle";
  return "other";
}

export function Upload({ preset, onAuth }: { preset: string | null; onAuth: () => void }) {
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [workId, setWorkId] = useState(preset ?? "");
  const [creating, setCreating] = useState(!preset);
  const [form, setForm] = useState({ title: "", type: "manga" as WorkType, year: "" });
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [message, setMessage] = useState("");
  const [rate, setRate] = useState(0);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const samples = useRef<{ t: number; sent: number }[]>([]);

  useEffect(() => {
    api<{ works: WorkSummary[] }>("/api/v1/works").then((r) => { setWorks(r.works); if (!preset && r.works.length) setCreating(false); })
      .catch((e) => (e instanceof AuthError ? onAuth() : setMessage(String(e.message))));
  }, [preset, onAuth]);

  function add(list: { file: File; rel?: string }[]) {
    const fresh = list.filter(({ file }) => !file.name.startsWith(".")).map(({ file, rel }) => ({ file, path: pathOf(file, rel), sent: 0, state: "waiting" as const }));
    setItems((cur) => [...cur, ...fresh.filter((f) => !cur.some((c) => c.path === f.path && c.file.size === f.file.size))]);
  }

  const total = items.reduce((n, it) => n + it.file.size, 0);
  const sent = items.reduce((n, it) => n + it.sent, 0);

  // Speed over the last few seconds, for "time left".
  useEffect(() => {
    if (!busy) { samples.current = []; setRate(0); return; }
    const now = performance.now();
    samples.current = [...samples.current.filter((s) => now - s.t < 6000), { t: now, sent }];
    const first = samples.current[0]!;
    const dt = (now - first.t) / 1000;
    if (dt > 0.8) setRate((sent - first.sent) / dt);
  }, [sent, busy]);

  async function start() {
    setMessage("");
    let target = workId;
    try {
      if (creating) {
        if (!form.title.trim()) { setMessage("Poné un título para la obra nueva."); return; }
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
        setItems((cur) => cur.map((it, j) => (j === i ? { ...it, state: "sending", error: undefined } : it)));
        try {
          await send(target, items[i]!, (n) => setItems((cur) => cur.map((it, j) => (j === i ? { ...it, sent: n } : it))));
          setItems((cur) => cur.map((it, j) => (j === i ? { ...it, state: "done", sent: it.file.size } : it)));
        } catch (e) {
          if (e instanceof AuthError) { onAuth(); return; }
          setItems((cur) => cur.map((it, j) => (j === i ? { ...it, state: "error", error: String((e as Error).message) } : it)));
        }
      }
    } catch (e) {
      if (e instanceof AuthError) onAuth(); else setMessage(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  const current = works.find((w) => w.id === workId);
  const video = current ? current.kind === "video" : ["film", "series", "anime"].includes(form.type);
  const accepts = video ? "video/*,.mkv,.srt,.vtt,.ass,.ssa" : "image/*,.cbz,.zip,.pdf";
  const done = items.length > 0 && items.every((it) => it.state === "done");
  const failed = items.filter((it) => it.state === "error").length;
  const share = (sent / Math.max(1, total)) * 100;
  const misfits = items.filter((it) => it.state === "waiting" && (video ? !["video", "subtitle"].includes(kindOf(it.path)) : !["pages", "image"].includes(kindOf(it.path))));

  return (
    <>
      <Header active="upload" />
      <main className="narrow upload">
        <h1>Subir</h1>
        <p className="faint">Solo obras que tenés legalmente. archivist no descarga nada: lee lo que subís, y si se corta, sigue desde donde quedó.</p>

        <section className="card">
          <div className="tabs" role="tablist" aria-label="Destino">
            <button role="tab" aria-selected={!creating} className={!creating ? "on" : ""} onClick={() => setCreating(false)} disabled={!works.length || busy}>
              A una obra
            </button>
            <button role="tab" aria-selected={creating} className={creating ? "on" : ""} onClick={() => setCreating(true)} disabled={busy}>
              Obra nueva
            </button>
          </div>
          {creating ? (
            <div className="new-work">
              <label htmlFor="title">Título</label>
              <input id="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Berserk" />
              <div className="split">
                <div>
                  <label htmlFor="type">Tipo</label>
                  <select id="type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as WorkType })}>
                    {(Object.keys(TYPE_LABEL) as WorkType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="year">Año</label>
                  <input id="year" inputMode="numeric" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="1989" />
                </div>
              </div>
            </div>
          ) : (
            <>
              <label htmlFor="work">Obra</label>
              <select id="work" value={workId} onChange={(e) => setWorkId(e.target.value)} disabled={busy}>
                <option value="">Elegir…</option>
                {works.map((w) => <option key={w.id} value={w.id}>{w.title} · {TYPE_LABEL[w.type]}</option>)}
              </select>
            </>
          )}
        </section>

        <section className={`drop ${over ? "over" : ""}`}
                 onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                 onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
                 onDrop={(e) => { e.preventDefault(); setOver(false); void dropped(e.dataTransfer).then(add); }}>
          <span className="drop-icon"><Icon name="upload" /></span>
          <strong>Arrastrá archivos o carpetas acá</strong>
          <span className="faint small">
            {video ? "Videos y sus subtítulos (.srt, .ass). Series: un archivo por episodio con S01E02 en el nombre."
              : "Un CBZ, ZIP o PDF por tomo, o una carpeta de imágenes por tomo."}
          </span>
          <div className="row">
            <button onClick={() => filesInput.current?.click()} disabled={busy}><Icon name="file" /> Elegir archivos</button>
            <button onClick={() => folderInput.current?.click()} disabled={busy}><Icon name="folder" /> Elegir una carpeta</button>
          </div>
          <input ref={filesInput} type="file" multiple accept={accepts} hidden onChange={(e) => { add([...(e.target.files ?? [])].map((file) => ({ file }))); e.target.value = ""; }} />
          <input ref={folderInput} type="file" multiple hidden onChange={(e) => { add([...(e.target.files ?? [])].map((file) => ({ file }))); e.target.value = ""; }}
                 {...{ webkitdirectory: "", directory: "" }} />
        </section>

        {items.length > 0 && (
          <section className="card queue">
            <div className="spread">
              <strong>{items.length} {items.length === 1 ? "archivo" : "archivos"} · {size(total)}</strong>
              <span className="faint small">
                {busy ? `${Math.round(share)} %${rate ? ` · ${size(rate)}/s · faltan ${eta((total - sent) / rate)}` : ""}` : done ? "Todo subido" : failed ? `${failed} con error` : "Listos para subir"}
              </span>
            </div>
            <div className="bar"><div style={{ width: `${share}%` }} /></div>
            {misfits.length > 0 && (
              <p className="notice small"><Icon name="file" /> {misfits.length === 1 ? "Un archivo no parece" : `${misfits.length} archivos no parecen`} de
                {video ? " video ni subtítulos" : " páginas"}: el servidor los va a rechazar.</p>
            )}
            <ul className="queue-list">
              {items.map((it, i) => {
                const k = kindOf(it.path);
                const p = (it.sent / Math.max(1, it.file.size)) * 100;
                return (
                  <li key={`${it.path}:${i}`} className={it.state}>
                    <span className="q-icon"><Icon name={k === "video" ? "play" : k === "image" ? "image" : k === "pages" ? "book" : k === "subtitle" ? "captions" : "file"} /></span>
                    <span className="q-main">
                      <span className="q-name" title={it.path}>{it.path}</span>
                      {it.state === "sending" && <span className="bar thin"><span style={{ width: `${p}%` }} /></span>}
                      {it.state === "error" && <span className="q-error">{it.error}</span>}
                    </span>
                    <span className="q-side">
                      {it.state === "done" ? <Icon name="check" className="icon ok" />
                        : it.state === "sending" ? `${Math.round(p)} %`
                        : it.state === "error" ? "Error"
                        : size(it.file.size)}
                    </span>
                    {!busy && it.state !== "done" && (
                      <button className="icon-only" aria-label={`Quitar ${it.path}`} onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))}>
                        <Icon name="close" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="row">
              <button className="primary lg" onClick={() => void start()} disabled={busy || done}>
                <Icon name="upload" /> {busy ? "Subiendo…" : failed ? "Reintentar" : "Subir"}
              </button>
              {!busy && <button onClick={() => setItems([])}>Vaciar la lista</button>}
              {workId && done && <a className="btn" href={`#/w/${workId}`}>Ver la obra <Icon name="next" /></a>}
            </div>
          </section>
        )}
        {message && <p className="notice">{message}</p>}
      </main>
    </>
  );
}
