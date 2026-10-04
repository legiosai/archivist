import { useEffect, useState } from "react";
import { getProfiles, type Profile } from "../api.ts";

export function Header({ back }: { back?: { href: string; label: string } }) {
  const [me, setMe] = useState<Profile | null>(null);
  const [many, setMany] = useState(false);
  useEffect(() => {
    getProfiles().then((r) => {
      setMe(r.profiles.find((p) => p.id === r.current) ?? null);
      setMany(r.profiles.length > 1);
    }).catch(() => undefined);
  }, []);
  return (
    <header className="top">
      <a className="brand" href="#/">archivist</a>
      <nav>
        {back && <a href={back.href}>← {back.label}</a>}
        <a href="#/">Biblioteca</a>
        <a href="#/subir">Subir</a>
        <a className="who" href="#/perfiles" title="Perfiles">{me ? me.name : "Perfil"}{many ? " ▾" : ""}</a>
      </nav>
    </header>
  );
}
