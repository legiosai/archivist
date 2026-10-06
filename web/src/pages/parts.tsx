import { useEffect, useRef, useState } from "react";
import { logout } from "../api.ts";
import { Icon, Mark } from "../icons.tsx";
import { Avatar, useProfiles } from "../profiles.tsx";

/** Opens the search palette from anywhere (Header button, Ctrl+K). */
export const openSearch = () => window.dispatchEvent(new Event("archivist:search"));

function ProfileMenu() {
  const { profiles, me, current, open, choose } = useProfiles();
  const [shown, setShown] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shown) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setShown(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setShown(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [shown]);
  return (
    <div className="menu-wrap" ref={box}>
      <button className={`who ${shown ? "on" : ""}`} onClick={() => setShown(!shown)} aria-haspopup="menu" aria-expanded={shown}
              title="Cambiar de perfil">
        <Avatar profile={me} size="sm" />
        <span className="label">{me?.name ?? "Perfil"}</span>
        <Icon name="chevron" className="icon chev" />
      </button>
      {shown && (
        <div className="menu" role="menu">
          <div className="menu-head">Perfiles</div>
          {profiles.map((p) => (
            <button key={p.id} role="menuitem" className={`menu-item ${p.id === current ? "on" : ""}`}
                    onClick={() => (p.id === current ? setShown(false) : void choose(p.id))}>
              <Avatar profile={p} size="sm" />
              <span>{p.name}</span>
              {p.id === current && <Icon name="check" className="icon tick" />}
            </button>
          ))}
          <div className="menu-sep" />
          <a role="menuitem" className="menu-item" href="#/resumen" onClick={() => setShown(false)}>
            <Icon name="calendar" /><span>Tu año</span>
          </a>
          <a role="menuitem" className="menu-item" href="#/perfiles" onClick={() => setShown(false)}>
            <Icon name="users" /><span>Administrar perfiles</span>
          </a>
          {!open && (
            <button role="menuitem" className="menu-item" onClick={async () => { await logout(); window.location.reload(); }}>
              <Icon name="logout" /><span>Cerrar sesión</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Header({ active }: { active?: "library" | "upload" | "profiles" | "year" }) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <>
      <div className="top-wrap">
        <header className="top">
          <a className="brand" href="#/"><Mark />archivist</a>
          <nav>
            <button className="search-btn wide-only" onClick={openSearch} title="Buscar">
              <Icon name="search" /><span className="label">Buscar</span><kbd className="label">{mac ? "⌘" : "Ctrl"} K</kbd>
            </button>
            <a href="#/" className={`wide-only ${active === "library" ? "on" : ""}`}><Icon name="library" /><span className="label">Biblioteca</span></a>
            <a href="#/subir" className={`wide-only ${active === "upload" ? "on" : ""}`}><Icon name="upload" /><span className="label">Subir</span></a>
            <ProfileMenu />
          </nav>
        </header>
      </div>
      {/* On a phone the sections sit at the bottom, under the thumb. */}
      <nav className="tabbar" aria-label="Secciones">
        <a href="#/" className={active === "library" ? "on" : ""}><Icon name="library" /><span>Inicio</span></a>
        <button onClick={openSearch}><Icon name="search" /><span>Buscar</span></button>
        <a href="#/subir" className={active === "upload" ? "on" : ""}><Icon name="upload" /><span>Subir</span></a>
        <a href="#/resumen" className={active === "year" ? "on" : ""}><Icon name="calendar" /><span>Tu año</span></a>
      </nav>
    </>
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
