import { useEffect, useRef, useState } from "react";
import { AuthError, api, go, saveProgress, unitPath, type VideoInfo, type WorkDetail } from "../api.ts";
import { Icon } from "../icons.tsx";

/**
 * The video, from where it was left. A file the browser can't play is prepared first (once);
 * the progress shows while ffmpeg works. The position is saved every few seconds and on pause.
 */
export function Player({ id, unitKey, onAuth }: { id: string; unitKey: string; onAuth: () => void }) {
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const lastSave = useRef(0);
  const base = unitPath(id, unitKey);

  const idx = work?.unitList.findIndex((u) => u.key === unitKey) ?? -1;
  const unit = work?.unitList[idx];
  const next = work && idx >= 0 ? work.unitList[idx + 1] : undefined;

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const i = await api<VideoInfo>(`${base}/info`);
        if (stop) return;
        setInfo(i);
        if (i.allowed === false) return;
        if (!i.ready) {
          if (!i.job || i.job.state === "queued" && i.job.progress === 0) await api(`${base}/prepare`, { method: "POST" });
          if (i.job?.state !== "failed") timer = setTimeout(poll, 2000);
        }
      } catch (e) {
        if (e instanceof AuthError) onAuth(); else setError(String((e as Error).message));
      }
    };
    api<WorkDetail>(`/api/v1/works/${id}`).then(setWork).catch((e) => (e instanceof AuthError ? onAuth() : setError(String(e.message))));
    void poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [id, base, onAuth]);

  useEffect(() => {
    const save = () => {
      const v = video.current;
      if (v && v.duration) void saveProgress(id, unitKey, v.currentTime, v.duration, true);
    };
    window.addEventListener("pagehide", save);
    return () => { save(); window.removeEventListener("pagehide", save); };
  }, [id, unitKey]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0 && next) { go(`#/v/${id}/${next.key}`); return; }
    const t = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, next, id]);

  function onLoaded() {
    const v = video.current;
    const p = unit?.progress;
    if (v && p && !p.finished && p.position > 5 && p.position < v.duration - 10) v.currentTime = p.position;
  }

  function onTime() {
    const v = video.current;
    if (!v || !v.duration) return;
    const now = Date.now();
    if (now - lastSave.current > 10_000) {
      lastSave.current = now;
      void saveProgress(id, unitKey, v.currentTime, v.duration);
    }
  }

  function onPause() {
    const v = video.current;
    if (v && v.duration) void saveProgress(id, unitKey, v.currentTime, v.duration);
  }

  function onEnded() {
    const v = video.current;
    if (v) void saveProgress(id, unitKey, v.duration, v.duration);
    if (next) setCountdown(8);
  }

  return (
    <div className="player">
      <div className="reader-bar">
        <a className="back" href={`#/w/${id}`}><Icon name="back" /><span>{work?.title ?? "Volver"}</span></a>
        {unit && <span className="pill">{unit.label}</span>}
        <span />
      </div>
      {error && <p className="notice bad">{error}</p>}
      {!info && !error && <div className="reader-loading"><div className="spinner" aria-label="Cargando" /></div>}
      {info?.allowed === false && (
        <div className="preparing">
          <Icon name="wifi" className="icon" />
          <h1>El video se ve en casa</h1>
          <p className="faint">Desde internet, archivist muestra la biblioteca, lee mangas y cómics y guarda tu progreso, pero no
            transmite películas ni episodios. Abrilo desde la red de tu casa o por Tailscale y sigue donde lo dejaste.</p>
          <a className="btn" href={`#/w/${id}`}><Icon name="back" /> Volver a la obra</a>
        </div>
      )}
      {info && info.allowed !== false && !info.ready && (
        <div className="preparing">
          {info.job?.state === "failed" ? (
            <p className="bad">No se pudo preparar el video: {info.job.error}</p>
          ) : (
            <>
              <div className="spinner" />
              <h1>Preparando el video{info.job && info.job.progress > 0 ? ` · ${Math.round(info.job.progress * 100)} %` : "…"}</h1>
              <p className="faint small">Pasa una sola vez por archivo. Si solo cambia el contenedor tarda segundos; si hay que convertir el video, más.</p>
              <div className="bar"><div style={{ width: `${(info.job?.progress ?? 0) * 100}%` }} /></div>
            </>
          )}
        </div>
      )}
      {info?.ready && info.allowed !== false && (
        <video ref={video} src={`${base}/video`} controls autoPlay playsInline preload="metadata"
               onLoadedMetadata={onLoaded} onTimeUpdate={onTime} onPause={onPause} onEnded={onEnded}>
          {info.subtitles.map((s, i) => <track key={s.href} kind="subtitles" src={s.href} label={s.label} default={i === 0} />)}
        </video>
      )}
      {countdown !== null && next && (
        <div className="next-up">
          <span>{next.label} en {countdown} s</span>
          <a className="btn primary" href={`#/v/${id}/${next.key}`}>Ver ahora</a>
          <button onClick={() => setCountdown(null)}>Cancelar</button>
        </div>
      )}
    </div>
  );
}
