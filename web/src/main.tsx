import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthError, getProfiles, hasProfileCookie } from "./api.ts";
import { Library } from "./pages/Library.tsx";
import { Login } from "./pages/Login.tsx";
import { Player } from "./pages/Player.tsx";
import { Profiles } from "./pages/Profiles.tsx";
import { Reader } from "./pages/Reader.tsx";
import { Upload } from "./pages/Upload.tsx";
import { WorkPage } from "./pages/WorkPage.tsx";
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

function App() {
  const [needLogin, setNeedLogin] = useState(false);
  const [pick, setPick] = useState(false);
  const parts = useHash();
  useEffect(() => {
    // With more than one profile and none chosen in this browser, ask who reads.
    if (hasProfileCookie()) return;
    getProfiles().then((r) => setPick(r.profiles.length > 1)).catch(() => undefined);
  }, []);
  useEffect(() => {
    const on = (e: PromiseRejectionEvent) => { if (e.reason instanceof AuthError) setNeedLogin(true); };
    window.addEventListener("unhandledrejection", on);
    return () => window.removeEventListener("unhandledrejection", on);
  }, []);
  if (needLogin) return <Login />;
  if (pick) return <Profiles onAuth={() => setNeedLogin(true)} picker />;
  const [view, kind, slug, unit] = parts;
  const id = kind && slug ? `${kind}/${slug}` : "";
  const onAuth = () => setNeedLogin(true);
  if (view === "w" && id) return <WorkPage id={id} onAuth={onAuth} />;
  if (view === "r" && id && unit) return <Reader id={id} unitKey={unit} onAuth={onAuth} />;
  if (view === "v" && id && unit) return <Player id={id} unitKey={unit} onAuth={onAuth} />;
  if (view === "subir") return <Upload preset={id || null} onAuth={onAuth} />;
  if (view === "perfiles") return <Profiles onAuth={onAuth} />;
  return <Library onAuth={onAuth} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
