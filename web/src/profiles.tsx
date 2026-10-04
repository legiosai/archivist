import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AuthError, getProfiles, isOpen, useProfile, type Profile } from "./api.ts";

/** Who is reading in this browser, shared by every page (one request, not one per header). */
interface ProfilesState {
  profiles: Profile[];
  current: string;
  me: Profile | null;
  /** This browser gets in without a token (home network, Tailscale). */
  open: boolean;
  ready: boolean;
  reload(): Promise<void>;
  /** Switch to another profile; the page reloads to show its shelf. */
  choose(id: string, to?: string): Promise<void>;
}

const Ctx = createContext<ProfilesState>({
  profiles: [], current: "owner", me: null, open: false, ready: false,
  reload: async () => undefined, choose: async () => undefined,
});

export function ProfilesProvider({ children, onAuth }: { children: React.ReactNode; onAuth: () => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [current, setCurrent] = useState("owner");
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await getProfiles();
      setProfiles(r.profiles);
      setCurrent(r.current);
    } catch (e) {
      if (e instanceof AuthError) onAuth();
    } finally {
      setReady(true);
    }
  }, [onAuth]);

  useEffect(() => {
    void reload();
    void isOpen().then(setOpen);
  }, [reload]);

  const choose = useCallback(async (id: string, to?: string) => {
    await useProfile(id);
    if (to) window.location.hash = to;
    window.location.reload();
  }, []);

  const me = profiles.find((p) => p.id === current) ?? null;
  return <Ctx.Provider value={{ profiles, current, me, open, ready, reload, choose }}>{children}</Ctx.Provider>;
}

export const useProfiles = () => useContext(Ctx);

/** A stable hue per profile id, for profiles that never picked one. */
export function idHue(id: string): number {
  if (id === "owner") return 32;
  let h = 7;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export const HUES = [32, 8, 340, 300, 265, 225, 200, 172, 140, 95];
export const GLYPHS = ["🦊", "🐉", "🐱", "🦉", "🐺", "🐼", "🦄", "🐙", "👾", "🤖", "🚀", "🌙", "⚡", "🔥", "🌸", "🍿", "🎬", "📚", "🎧", "⚔️", "🗡️", "🛡️", "👻", "🎮"];

export function Avatar({ profile, size = "md", className = "" }: {
  profile: Pick<Profile, "id" | "name" | "hue" | "glyph"> | null; size?: "sm" | "md" | "lg" | "xl"; className?: string;
}) {
  const h = profile?.hue ?? idHue(profile?.id ?? "owner");
  const glyph = profile?.glyph;
  return (
    <span className={`avatar ${size} ${glyph ? "emoji" : ""} ${className}`.trim()} style={{ "--h": h } as React.CSSProperties} aria-hidden="true">
      {glyph ?? (profile?.name ?? "·").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "todavía nada";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 2) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d < 60 ? `hace ${d} días` : `hace ${Math.round(d / 30)} meses`;
}
