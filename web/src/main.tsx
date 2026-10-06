import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthError, hasProfileCookie } from "./api.ts";
import { ProfilesProvider, useProfiles } from "./profiles.tsx";
import { Palette } from "./pages/Palette.tsx";
import { Picker } from "./pages/Picker.tsx";
import { Catalog, Library } from "./pages/Library.tsx";
import { Login } from "./pages/Login.tsx";
import { Player } from "./pages/Player.tsx";
import { Profiles } from "./pages/Profiles.tsx";
import { Reader } from "./pages/Reader.tsx";
import { Upload } from "./pages/Upload.tsx";
import { WorkPage } from "./pages/WorkPage.tsx";
import { Year } from "./pages/Year.tsx";
import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/fraunces/opsz-italic.css";
import "./styles.css";

function useHash(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("?")[0]!.split("/").filter(Boolean).map(decodeURIComponent);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => { setParts(read()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return parts;
}

function App({ onAuth }: { onAuth: () => void }) {
  const { ready } = useProfiles();
  const parts = useHash();
  const [view, kind, slug, unit] = parts;
  if (!ready) return <div className="reader-loading"><div className="spinner" aria-label="Cargando" /></div>;
  // A browser that hasn't said who it is asks first, as streaming services do.
  if (!hasProfileCookie() && view !== "perfiles") return <Picker />;
  const id = kind && slug ? `${kind}/${slug}` : "";
  if (view === "w" && id) return <WorkPage id={id} onAuth={onAuth} />;
  if (view === "r" && id && unit) return <Reader id={id} unitKey={unit} onAuth={onAuth} />;
  if (view === "v" && id && unit) return <Player id={id} unitKey={unit} onAuth={onAuth} />;
  if (view === "subir") return <Upload preset={id || null} onAuth={onAuth} />;
  if (view === "perfiles") return <Profiles onAuth={onAuth} />;
  if (view === "resumen") return <Year onAuth={onAuth} />;
  if (view === "todo") return <Catalog key={window.location.hash} onAuth={onAuth} />;
  return <Library onAuth={onAuth} />;
}

function Root() {
  const [needLogin, setNeedLogin] = useState(false);
  const onAuth = useCallback(() => setNeedLogin(true), []);
  useEffect(() => {
    const on = (e: PromiseRejectionEvent) => { if (e.reason instanceof AuthError) setNeedLogin(true); };
    window.addEventListener("unhandledrejection", on);
    return () => window.removeEventListener("unhandledrejection", on);
  }, []);
  if (needLogin) return <Login />;
  return (
    <ProfilesProvider onAuth={onAuth}>
      <App onAuth={onAuth} />
      <Palette />
    </ProfilesProvider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Root /></StrictMode>);
