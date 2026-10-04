import { useState } from "react";
import { Icon, Mark } from "../icons.tsx";
import { Avatar, useProfiles } from "../profiles.tsx";

/**
 * "¿Quién está mirando?": the first screen in a browser that hasn't chosen a profile yet, as on
 * the streaming services. Each person keeps their own place in every work.
 */
export function Picker() {
  const { profiles, choose } = useProfiles();
  const [busy, setBusy] = useState<string | null>(null);
  const pick = (id: string) => { setBusy(id); void choose(id); };   // stays on the link it was opened with
  return (
    <div className="picker">
      <div className="picker-brand"><Mark />archivist</div>
      <h1>¿Quién está mirando?</h1>
      <div className="picker-grid">
        {profiles.map((p, i) => (
          <button key={p.id} className={`picker-item ${busy === p.id ? "busy" : ""}`} onClick={() => pick(p.id)}
                  style={{ "--i": i } as React.CSSProperties} disabled={busy !== null}>
            <Avatar profile={p} size="xl" />
            <span className="picker-name">{p.name}</span>
            {p.stats && p.stats.inProgress > 0 && <span className="picker-sub">{p.stats.inProgress} en curso</span>}
          </button>
        ))}
        <button className="picker-item add" onClick={() => choose(profiles[0]?.id ?? "owner", "#/perfiles?nuevo=1")}
                style={{ "--i": profiles.length } as React.CSSProperties} disabled={busy !== null}>
          <span className="avatar xl ghost"><Icon name="plus" /></span>
          <span className="picker-name">Agregar</span>
        </button>
      </div>
      <a className="btn ghost" href="#/perfiles" onClick={(e) => { e.preventDefault(); void choose(profiles[0]?.id ?? "owner", "#/perfiles"); }}>
        Administrar perfiles
      </a>
    </div>
  );
}
