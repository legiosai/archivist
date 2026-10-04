import { useState } from "react";
import { Icon, Mark } from "../icons.tsx";

export function Login() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await fetch("/api/v1/login", { method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => null);
    setBusy(false);
    if (r?.ok) window.location.reload();
    else if (r?.status === 429) setError("Demasiados intentos. Esperá unos minutos.");
    else setError(r ? "Ese token no es." : "No se pudo conectar.");
  }
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand"><Mark />archivist</div>
        <p className="faint small">Tu biblioteca de películas, series, anime, manga y cómics.</p>
        <label htmlFor="token">Token</label>
        <input id="token" type="password" autoFocus autoComplete="current-password" value={token} onChange={(e) => setToken(e.target.value)} />
        {error && <p className="bad small">{error}</p>}
        <button className="primary" type="submit" disabled={busy || !token}>{busy ? "Entrando…" : "Entrar"}</button>
        <p className="faint small hint">
          <Icon name="shield" /><span>El de ARCHIVIST_TOKEN en el servidor. Este navegador queda con una sesión que podés cerrar desde Perfiles.</span>
        </p>
      </form>
    </div>
  );
}
