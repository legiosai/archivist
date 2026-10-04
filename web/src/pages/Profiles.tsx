import { useEffect, useState } from "react";
import { AuthError, api, logout, useQuery, type Profile, type Session } from "../api.ts";
import { Icon } from "../icons.tsx";
import { Avatar, GLYPHS, HUES, ago, idHue, useProfiles } from "../profiles.tsx";
import { Header } from "./parts.tsx";

/** "Firefox en Linux", "Safari en iPhone": enough to tell sessions apart. */
function device(agent: string): string {
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome"
    : /Safari\//.test(agent) ? "Safari" : agent.split(" ")[0] || "Navegador";
  const os = /iPhone|iPad/.test(agent) ? "iPhone/iPad" : /Android/.test(agent) ? "Android" : /Mac OS X/.test(agent) ? "Mac"
    : /Windows/.test(agent) ? "Windows" : /Linux/.test(agent) ? "Linux" : "";
  return os ? `${browser} en ${os}` : browser;
}

interface Draft { id: string | null; name: string; hue: number | null; glyph: string | null }

function Editor({ draft, onDone, onAuth }: { draft: Draft; onDone: () => void; onAuth: () => void }) {
  const { reload, current, choose } = useProfiles();
  const [d, setD] = useState(draft);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isNew = d.id === null;
  const preview = { id: d.id ?? (d.name.toLowerCase() || "nuevo"), name: d.name || "?", hue: d.hue, glyph: d.glyph };
  const shownHue = d.hue ?? idHue(preview.id);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = JSON.stringify({ name: d.name, hue: d.hue, glyph: d.glyph });
      if (isNew) await api("/api/v1/profiles", { method: "POST", body });
      else await api(`/api/v1/profiles/${d.id}`, { method: "PATCH", body });
      await reload();
      onDone();
    } catch (err) {
      if (err instanceof AuthError) onAuth(); else setError(String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!d.id || !window.confirm(`¿Borrar el perfil «${draft.name}» y todo su progreso? No se puede deshacer.`)) return;
    try {
      await api(`/api/v1/profiles/${d.id}`, { method: "DELETE" });
      if (d.id === current) await choose("owner");
      await reload();
      onDone();
    } catch (err) { setError(String((err as Error).message)); }
  }

  return (
    <form className="card editor" onSubmit={save}>
      <div className="editor-preview">
        <Avatar profile={preview} size="xl" />
        <strong>{d.name || (isNew ? "Perfil nuevo" : "")}</strong>
      </div>
      <div className="editor-fields">
        <h3>{isNew ? "Perfil nuevo" : `Editar a ${draft.name}`}</h3>
        <label htmlFor="pname">Nombre</label>
        <input id="pname" value={d.name} maxLength={40} autoFocus placeholder="Sol" onChange={(e) => setD({ ...d, name: e.target.value })} />
        <label>Color</label>
        <div className="swatches" role="radiogroup" aria-label="Color">
          {HUES.map((h) => (
            <button key={h} type="button" role="radio" aria-checked={shownHue === h} aria-label={`Color ${h}`}
                    className={`swatch ${shownHue === h ? "on" : ""}`} style={{ "--h": h } as React.CSSProperties}
                    onClick={() => setD({ ...d, hue: h })} />
          ))}
        </div>
        <label>Ícono</label>
        <div className="glyphs" role="radiogroup" aria-label="Ícono">
          <button type="button" role="radio" aria-checked={!d.glyph} className={`glyph letter ${!d.glyph ? "on" : ""}`}
                  onClick={() => setD({ ...d, glyph: null })} title="La inicial">{(d.name || "A").slice(0, 1).toUpperCase()}</button>
          {GLYPHS.map((g) => (
            <button key={g} type="button" role="radio" aria-checked={d.glyph === g} className={`glyph ${d.glyph === g ? "on" : ""}`}
                    onClick={() => setD({ ...d, glyph: g })}>{g}</button>
          ))}
        </div>
        {error && <p className="bad small">{error}</p>}
        <div className="row editor-actions">
          <button className="primary" type="submit" disabled={busy || !d.name.trim()}>{isNew ? "Crear perfil" : "Guardar"}</button>
          <button type="button" onClick={onDone}>Cancelar</button>
          {!isNew && d.id !== "owner" && <button type="button" className="link danger" onClick={remove}>Borrar perfil</button>}
        </div>
      </div>
    </form>
  );
}

/** Who reads here: switch, add, restyle or remove, plus each one's phone catalog and the open sessions. */
export function Profiles({ onAuth }: { onAuth: () => void }) {
  const { profiles, current, open, choose } = useProfiles();
  const wantsNew = useQuery("nuevo") === "1";
  const [editing, setEditing] = useState<Draft | null>(wantsNew ? { id: null, name: "", hue: null, glyph: null } : null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [copied, setCopied] = useState("");

  const loadSessions = () => api<{ sessions: Session[] }>("/api/v1/sessions").then((r) => setSessions(r.sessions))
    .catch((e) => { if (e instanceof AuthError) onAuth(); });
  useEffect(() => { void loadSessions(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  async function endAll() {
    if (!window.confirm("¿Cerrar todas las sesiones? Cada navegador va a pedir el token de nuevo.")) return;
    await api("/api/v1/sessions", { method: "DELETE" });
    if (open) void loadSessions(); else window.location.reload();
  }

  async function copy(p: Profile) {
    const url = `${window.location.origin}/opds?profile=${encodeURIComponent(p.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(p.id);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      window.prompt("Catálogo OPDS de este perfil", url);
    }
  }

  const edit = (p: Profile) => {
    setEditing({ id: p.id, name: p.name, hue: p.hue, glyph: p.glyph });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <Header active="profiles" />
      <main>
        <div className="page-head">
          <div>
            <span className="eyebrow">Tu casa</span>
            <h1>Perfiles</h1>
            <p className="faint">Cada persona guarda su propio lugar en cada obra: el tomo y la página, el episodio y el minuto.</p>
          </div>
          {!editing && (
            <button className="primary" onClick={() => setEditing({ id: null, name: "", hue: null, glyph: null })}>
              <Icon name="plus" /> Agregar perfil
            </button>
          )}
        </div>

        {editing && <Editor key={editing.id ?? "new"} draft={editing} onDone={() => setEditing(null)} onAuth={onAuth} />}

        <div className="profile-cards">
          {profiles.map((p, i) => {
            const s = p.stats;
            const here = p.id === current;
            return (
              <article key={p.id} className={`profile-card ${here ? "here" : ""}`}
                       style={{ "--i": i, "--h": p.hue ?? idHue(p.id) } as React.CSSProperties}>
                <div className="profile-card-top">
                  <Avatar profile={p} size="lg" />
                  <div className="profile-card-name">
                    <h3>{p.name}</h3>
                    <span className="faint small">
                      {p.id === "owner" ? "Dueño" : `Desde ${new Date(p.createdAt).toLocaleDateString("es-AR", { month: "long", year: "numeric" })}`}
                    </span>
                  </div>
                  {here && <span className="here-badge">Estás acá</span>}
                </div>
                <div className="profile-stats">
                  <div><strong>{s?.inProgress ?? 0}</strong><span>en curso</span></div>
                  <div><strong>{s?.finishedUnits ?? 0}</strong><span>terminados</span></div>
                  <div><strong className="when">{ago(s?.lastAt)}</strong><span>último</span></div>
                </div>
                <div className="row profile-actions">
                  {!here && <button className="primary" onClick={() => choose(p.id, "#/")}>Usar este perfil</button>}
                  <button onClick={() => edit(p)}><Icon name="pencil" /> Editar</button>
                  <button className="link" onClick={() => copy(p)} title="El catálogo OPDS de este perfil, para Panels, Chunky, KOReader o Mihon">
                    {copied === p.id ? "¡Copiado!" : "Catálogo para el celular"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <section className="card">
          <h3>Sesiones</h3>
          <p className="faint small">
            {open ? "Esta red entra sin token. Estos son los navegadores que entraron con el token desde afuera."
              : "Los navegadores que entraron con el token. Si no reconocés uno, cerrá todas y cambiá ARCHIVIST_TOKEN."}
          </p>
          {sessions.length === 0 ? <p className="faint small">Ninguna abierta.</p> : (
            <ul className="sessions">
              {sessions.map((s) => (
                <li key={s.created_at + s.ip}><span>{device(s.agent)} · {s.ip}</span><span className="faint">{ago(s.last_seen)}</span></li>
              ))}
            </ul>
          )}
          <div className="row">
            {!open && (
              <button onClick={async () => { await logout(); window.location.hash = "#/"; window.location.reload(); }}>
                <Icon name="logout" /> Cerrar sesión
              </button>
            )}
            {sessions.length > 0 && <button className="link" onClick={endAll}>Cerrar todas</button>}
          </div>
        </section>
      </main>
    </>
  );
}
