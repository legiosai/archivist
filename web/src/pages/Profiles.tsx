import { useEffect, useState } from "react";
import { AuthError, api, getProfiles, isOpen, logout, useProfile, type Profile, type Session } from "../api.ts";
import { Icon } from "../icons.tsx";
import { Header, hue } from "./parts.tsx";

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 2) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

/** "Firefox en Linux", "Safari en iPhone": enough to tell sessions apart. */
function device(agent: string): string {
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome"
    : /Safari\//.test(agent) ? "Safari" : agent.split(" ")[0] || "Navegador";
  const os = /iPhone|iPad/.test(agent) ? "iPhone/iPad" : /Android/.test(agent) ? "Android" : /Mac OS X/.test(agent) ? "Mac"
    : /Windows/.test(agent) ? "Windows" : /Linux/.test(agent) ? "Linux" : "";
  return os ? `${browser} en ${os}` : browser;
}

/** Who reads: switch, add, rename or remove. Each profile keeps its own place in every work. */
export function Profiles({ onAuth, picker = false }: { onAuth: () => void; picker?: boolean }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [current, setCurrent] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [open, setOpen] = useState(true);

  const loadSessions = () => api<{ sessions: Session[] }>("/api/v1/sessions").then((r) => setSessions(r.sessions)).catch(() => undefined);
  useEffect(() => {
    if (picker) return;
    void loadSessions();
    void isOpen().then(setOpen);
  }, [picker]);

  async function endAll() {
    if (!window.confirm("¿Cerrar todas las sesiones? Cada navegador va a pedir el token de nuevo.")) return;
    await api("/api/v1/sessions", { method: "DELETE" });
    if (open) void loadSessions(); else window.location.reload();
  }

  async function leave() {
    await logout();
    window.location.hash = "#/";
    window.location.reload();
  }

  const load = () => getProfiles().then((r) => { setProfiles(r.profiles); setCurrent(r.current); })
    .catch((e) => (e instanceof AuthError ? onAuth() : setError(String(e.message))));
  useEffect(() => { void load(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  async function choose(id: string) {
    await useProfile(id);
    window.location.hash = "#/";
    window.location.reload();
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/v1/profiles", { method: "POST", body: JSON.stringify({ name }) });
      setName("");
      await load();
    } catch (err) { setError(String((err as Error).message)); }
  }

  async function rename(id: string) {
    try {
      await api(`/api/v1/profiles/${id}`, { method: "PATCH", body: JSON.stringify({ name: editName }) });
      setEditing(null);
      await load();
    } catch (err) { setError(String((err as Error).message)); }
  }

  async function remove(p: Profile) {
    if (!window.confirm(`¿Borrar el perfil «${p.name}» y todo su progreso?`)) return;
    try {
      await api(`/api/v1/profiles/${p.id}`, { method: "DELETE" });
      await load();
    } catch (err) { setError(String((err as Error).message)); }
  }

  return (
    <>
      {!picker && <Header active="profiles" />}
      <main className="narrow">
        <h1>{picker ? "¿Quién lee?" : "Perfiles"}</h1>
        <p className="faint small">Cada perfil guarda su propio lugar en cada obra. En el celular, el usuario de OPDS elige el perfil.</p>
        <div className="profiles">
          {profiles.map((p, i) => (
            <div key={p.id} className={`profile ${p.id === current ? "on" : ""}`} style={{ "--i": i } as React.CSSProperties}>
              <button className="avatar" style={{ "--h": hue(p.id) } as React.CSSProperties} onClick={() => choose(p.id)}
                      aria-label={`Usar el perfil ${p.name}`}>{p.name.slice(0, 1).toUpperCase()}</button>
              {editing === p.id ? (
                <div className="row">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} aria-label="Nombre" />
                  <button onClick={() => rename(p.id)}>Guardar</button>
                </div>
              ) : (
                <strong>{p.name}</strong>
              )}
              {!picker && editing !== p.id && (
                <span className="row small">
                  <button className="link" onClick={() => { setEditing(p.id); setEditName(p.name); }}>Renombrar</button>
                  {p.id !== "owner" && <button className="link" onClick={() => remove(p)}>Borrar</button>}
                </span>
              )}
            </div>
          ))}
        </div>
        <form className="card" onSubmit={add}>
          <label htmlFor="pname">Nuevo perfil</label>
          <div className="row">
            <input id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sol" />
            <button className="primary" type="submit" disabled={!name.trim()}>Agregar</button>
          </div>
        </form>
        {error && <p className="bad">{error}</p>}
        {!picker && (
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
              {!open && <button onClick={leave}><Icon name="logout" /> Cerrar sesión</button>}
              {sessions.length > 0 && <button className="link" onClick={endAll}>Cerrar todas</button>}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
