import { useState } from "react";

export function Login() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch("/api/v1/login", { method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    if (r.ok) window.location.reload();
    else setError("Ese token no es.");
  }
  return (
    <main className="narrow">
      <h1 className="brand">archivist</h1>
      <form className="card" onSubmit={submit}>
        <label htmlFor="token">Token</label>
        <input id="token" type="password" autoFocus value={token} onChange={(e) => setToken(e.target.value)} />
        <p className="faint small">El de ARCHIVIST_TOKEN en el servidor. Se pide una vez por navegador.</p>
        {error && <p className="bad">{error}</p>}
        <button className="primary" type="submit">Entrar</button>
      </form>
    </main>
  );
}
