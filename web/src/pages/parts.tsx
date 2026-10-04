import { useEffect, useState } from "react";
import { getProfiles, type Profile } from "../api.ts";
import { Icon, Mark } from "../icons.tsx";

/** A stable hue per profile, so each person has their own color. */
export function hue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return id === "owner" ? 38 : h;
}

export function Header({ active }: { active?: "library" | "upload" | "profiles" }) {
  const [me, setMe] = useState<Profile | null>(null);
  useEffect(() => {
    getProfiles().then((r) => setMe(r.profiles.find((p) => p.id === r.current) ?? null)).catch(() => undefined);
  }, []);
  return (
    <div className="top-wrap">
      <header className="top">
        <a className="brand" href="#/"><Mark />archivist</a>
        <nav>
          <a href="#/" className={active === "library" ? "on" : ""}><Icon name="library" /><span className="label">Biblioteca</span></a>
          <a href="#/subir" className={active === "upload" ? "on" : ""}><Icon name="upload" /><span className="label">Subir</span></a>
          <a className={`who ${active === "profiles" ? "on" : ""}`} href="#/perfiles" title="Perfiles">
            <span className="avatar-sm" style={{ "--h": hue(me?.id ?? "owner") } as React.CSSProperties}>
              {(me?.name ?? "·").slice(0, 1).toUpperCase()}
            </span>
            <span className="label">{me ? me.name : "Perfil"}</span>
          </a>
        </nav>
      </header>
    </div>
  );
}

/** An image that fades in once loaded, and gives way to `fallback` if it fails. */
export function Img({ src, alt = "", className, fallback = null }: { src: string; alt?: string; className?: string; fallback?: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  if (state === "failed") return <>{fallback}</>;
  return (
    <img src={src} alt={alt} loading="lazy" decoding="async" className={`${className ?? ""} ${state === "loading" ? "loading" : ""}`.trim()}
         onLoad={() => setState("ok")} onError={() => setState("failed")} />
  );
}

/** A cover at grid size: the server keeps a small copy (`?w=`). */
export const thumb = (src: string, w: number) => `${src}${src.includes("?") ? "&" : "?"}w=${w}`;

export function SkeletonGrid({ n = 12 }: { n?: number }) {
  return (
    <div className="grid" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: n }, (_, i) => (
        <div key={i}><div className="skeleton poster" /><div className="skeleton line" /></div>
      ))}
    </div>
  );
}
