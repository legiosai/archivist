import { useEffect, useState } from "react";
import { AuthError, api, getProfiles, useProfile, type Profile } from "../api.ts";
import { Header } from "./parts.tsx";

/** Who reads: switch, add, rename or remove. Each profile keeps its own place in every work. */
export function Profiles({ onAuth, picker = false }: { onAuth: () => void; picker?: boolean }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [current, setCurrent] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");

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
      {!picker && <Header />}
      <main className="narrow">
        <h1>{picker ? "¿Quién lee?" : "Perfiles"}</h1>
        <p className="faint small">Cada perfil guarda su propio lugar en cada obra. En el celular, el usuario de OPDS elige el perfil.</p>
        <div className="profiles">
          {profiles.map((p) => (
            <div key={p.id} className={`profile ${p.id === current ? "on" : ""}`}>
              <button className="avatar" onClick={() => choose(p.id)} aria-label={`Usar el perfil ${p.name}`}>{p.name.slice(0, 1).toUpperCase()}</button>
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
      </main>
    </>
  );
}
