import { useEffect, useRef, useState } from "react";
import { AuthError, api, go, saveProgress, trackLabel, unitPath, type SubtitleTrack, type TrackChoice, type VideoInfo, type WorkDetail } from "../api.ts";
import { Icon } from "../icons.tsx";

/** The audio track that fits a saved choice: same language first, then the same number. */
function audioFor(info: VideoInfo, choice: TrackChoice | null): number {
  const a = choice?.audio;
  if (!a) return 0;
  const byLang = a.lang ? info.audios.find((t) => t.lang === a.lang) : undefined;
  if (byLang) return byLang.n;
  return info.audios.some((t) => t.n === a.n) ? a.n : 0;
}

/** The subtitle that fits a saved choice, or "off"; with none saved, the first one, as before. */
function subtitleFor(subs: SubtitleTrack[], choice: TrackChoice | null): string | "off" {
  const s = choice?.subtitle;
  if (s === "off") return "off";
  if (s) {
    const hit = (s.lang ? subs.filter((t) => t.lang === s.lang).sort((a, b) => Number(a.forced) - Number(b.forced))[0] : undefined)
      ?? subs.find((t) => t.label && t.label === s.label);
    if (hit) return hit.href;
  }
  return subs[0]?.href ?? "off";
}

const subLabel = (s: SubtitleTrack, i: number) =>
  `${trackLabel({ lang: s.lang, title: s.kind === "embedded" ? s.label : null, label: s.label }, i)}${s.forced ? " · forzados" : ""}`;

/**
 * The video, from where it was left. A file the browser can't play (or another audio track) is
 * prepared first, once; the progress shows while ffmpeg works. The position is saved every few
 * seconds and on pause; the audio and subtitles each profile picks carry to the next episode.
 */
export function Player({ id, unitKey, onAuth }: { id: string; unitKey: string; onAuth: () => void }) {
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [choice, setChoice] = useState<TrackChoice | null | undefined>(undefined);
  const [audio, setAudio] = useState<number | null>(null);
  const [sub, setSub] = useState<string | "off" | null>(null);
  const [panel, setPanel] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const lastSave = useRef(0);
  const resumeAt = useRef<number | null>(null);
  const base = unitPath(id, unitKey);

  const idx = work?.unitList.findIndex((u) => u.key === unitKey) ?? -1;
  const unit = work?.unitList[idx];
  const next = work && idx >= 0 ? work.unitList[idx + 1] : undefined;

  // The work, and this profile's audio and subtitle choice for it.
  useEffect(() => {
    api<WorkDetail>(`/api/v1/works/${id}`).then(setWork).catch((e) => (e instanceof AuthError ? onAuth() : setError(String(e.message))));
    api<{ choice: TrackChoice | null }>(`/api/v1/works/${id}/tracks`).then((r) => setChoice(r.choice)).catch(() => setChoice(null));
  }, [id, onAuth]);

  // What the file has, with the audio track in use, preparing it if the browser can't play it yet.
  const known = choice !== undefined;
  useEffect(() => {
    if (!known) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const asked = audio ?? 0;
        const i = await api<VideoInfo>(`${base}/info${asked ? `?audio=${asked}` : ""}`);
        if (stop) return;
        if (audio === null) {
          // The first look: the subtitle this profile picked before, and its audio track (which may need asking again).
          setSub(subtitleFor(i.subtitles, choice ?? null));
          const want = audioFor(i, choice ?? null);
          setAudio(want);
          if (want !== 0) return;
        }
        setInfo(i);
        if (i.allowed === false || i.ready) return;
        if (!i.job || (i.job.state === "queued" && i.job.progress === 0)) {
          await api(`${base}/prepare${i.audioTrack ? `?audio=${i.audioTrack}` : ""}`, { method: "POST" });
        }
        if (i.job?.state !== "failed") timer = setTimeout(poll, 2000);
      } catch (e) {
        if (e instanceof AuthError) onAuth(); else setError(String((e as Error).message));
      }
    };
    void poll();
    return () => { stop = true; clearTimeout(timer); };
    // The choice is read once, on the first look; later changes come through `audio`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, audio, known, onAuth]);

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

  // The subtitle shown: one track "showing", the rest off.
  function applySubtitle() {
    const v = video.current;
    if (!v || !info) return;
    for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i]!.mode = info.subtitles[i]?.href === sub ? "showing" : "disabled";
  }
  useEffect(applySubtitle, [sub, info]);

  function remember(next: TrackChoice) {
    setChoice(next);
    void api(`/api/v1/works/${id}/tracks`, { method: "PUT", body: JSON.stringify(next) }).catch(() => undefined);
  }

  function pickAudio(n: number) {
    if (!info || n === info.audioTrack) return;
    const v = video.current;
    if (v) {
      resumeAt.current = v.currentTime;
      if (v.duration) void saveProgress(id, unitKey, v.currentTime, v.duration);
    }
    const t = info.audios.find((a) => a.n === n);
    remember({ audio: { lang: t?.lang ?? null, n }, subtitle: choice?.subtitle ?? null });
    setInfo(null);
    setAudio(n);
  }

  function pickSubtitle(href: string | "off") {
    setSub(href);
    const t = info?.subtitles.find((s) => s.href === href);
    remember({ audio: choice?.audio ?? null, subtitle: href === "off" ? "off" : { lang: t?.lang ?? null, label: t?.label ?? null } });
  }

  function onLoaded() {
    const v = video.current;
    applySubtitle();
    if (!v) return;
    if (resumeAt.current !== null) {
      v.currentTime = resumeAt.current;
      resumeAt.current = null;
      return;
    }
    const p = unit?.progress;
    if (p && !p.finished && p.position > 5 && p.position < v.duration - 10) v.currentTime = p.position;
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

  const tracks = !!info && (info.audios.length > 1 || info.subtitles.length > 0);
  const src = `${base}/video${info?.audioTrack ? `?audio=${info.audioTrack}` : ""}`;

  return (
    <div className="player">
      <div className="reader-bar">
        <a className="back" href={`#/w/${id}`}><Icon name="back" /><span>{work?.title ?? "Volver"}</span></a>
        {unit && <span className="pill">{unit.label}</span>}
        <div className="menu-wrap">
          {tracks ? (
            <button className={`tracks-btn ${panel ? "on" : ""}`} onClick={() => setPanel(!panel)} aria-haspopup="dialog" aria-expanded={panel}>
              <Icon name="captions" /><span className="label">Audio y subtítulos</span>
            </button>
          ) : <span />}
          {panel && info && (
            <div className="menu tracks" role="dialog" aria-label="Audio y subtítulos">
              {info.audios.length > 1 && (
                <div>
                  <div className="menu-head">Audio</div>
                  {info.audios.map((a, i) => (
                    <button key={a.n} className={`menu-item ${a.n === info.audioTrack ? "on" : ""}`} onClick={() => { pickAudio(a.n); setPanel(false); }}>
                      <span>{trackLabel(a, i)}</span>
                      {a.n === info.audioTrack && <Icon name="check" className="icon tick" />}
                    </button>
                  ))}
                </div>
              )}
              <div>
                <div className="menu-head">Subtítulos</div>
                <button className={`menu-item ${sub === "off" ? "on" : ""}`} onClick={() => pickSubtitle("off")}>
                  <span>Desactivados</span>{sub === "off" && <Icon name="check" className="icon tick" />}
                </button>
                {info.subtitles.map((s, i) => (
                  <button key={s.href} className={`menu-item ${sub === s.href ? "on" : ""}`} onClick={() => pickSubtitle(s.href)}>
                    <span>{subLabel(s, i)}</span>
                    {sub === s.href && <Icon name="check" className="icon tick" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
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
              <p className="faint small">
                {info.audioTrack
                  ? "Con otro audio se prepara una copia aparte, una sola vez. Después cambiar es inmediato."
                  : "Pasa una sola vez por archivo. Si solo cambia el contenedor tarda segundos; si hay que convertir el video, más."}
              </p>
              <div className="bar"><div style={{ width: `${(info.job?.progress ?? 0) * 100}%` }} /></div>
            </>
          )}
        </div>
      )}
      {info?.ready && info.allowed !== false && (
        <video key={src} ref={video} src={src} controls autoPlay playsInline preload="metadata"
               onLoadedMetadata={onLoaded} onTimeUpdate={onTime} onPause={onPause} onEnded={onEnded}>
          {info.subtitles.map((s, i) => <track key={s.href} kind="subtitles" src={s.href} srcLang={s.lang ?? undefined} label={subLabel(s, i)} />)}
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
