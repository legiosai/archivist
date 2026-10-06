import { useCallback, useEffect, useRef, useState } from "react";
import { AuthError, api, clock, go, saveProgress, trackLabel, unitPath, type SubtitleTrack, type TrackChoice, type VideoInfo, type WorkDetail } from "../api.ts";
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

/** The volume icon: three bars, crossed out when muted. */
function VolumeIcon({ level, muted }: { level: number; muted: boolean }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" />
      {muted || level === 0 ? <><path d="m16 9.5 5 5" /><path d="m21 9.5-5 5" /></>
        : <><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />{level > 0.5 && <path d="M18 7a7 7 0 0 1 0 10" />}</>}
    </svg>
  );
}

/**
 * The video, from where it was left, with its own controls: the title on top, a scrubber that
 * shows the frame under the pointer, ten seconds back and forward, audio and subtitles, the next
 * episode, fullscreen. A file the browser can't play (or another audio track) is prepared first,
 * once. The position is saved every few seconds and on pause; each profile's audio and subtitles
 * carry to the next episode.
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
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [now, setNow] = useState(0);
  const [length, setLength] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(() => { try { return Number(localStorage.getItem("volume") ?? 1); } catch { return 1; } });
  const [muted, setMuted] = useState(false);
  const [shown, setShown] = useState(true);
  const [full, setFull] = useState(false);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [flash, setFlash] = useState<{ side: "left" | "right"; key: number } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const scrub = useRef<HTMLDivElement>(null);
  const lastSave = useRef(0);
  const resumeAt = useRef<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastTap = useRef<{ t: number; x: number } | null>(null);
  const lastSub = useRef<string | null>(null);
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
  const applySubtitle = useCallback(() => {
    const v = video.current;
    if (!v || !info) return;
    for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i]!.mode = info.subtitles[i]?.href === sub ? "showing" : "disabled";
  }, [info, sub]);
  useEffect(applySubtitle, [applySubtitle]);

  // Subtitles move up while the controls show, so the bar never covers them.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const lift = () => {
      for (let i = 0; i < v.textTracks.length; i++) {
        for (const cue of [...(v.textTracks[i]!.cues ?? [])] as VTTCue[]) cue.line = shown || !playing ? -4 : "auto";
      }
    };
    lift();
    const tracks = [...v.textTracks];
    tracks.forEach((t) => t.addEventListener("cuechange", lift));
    return () => tracks.forEach((t) => t.removeEventListener("cuechange", lift));
  }, [shown, playing, sub, info]);

  // The controls hide after a moment of playing without the pointer moving.
  const poke = useCallback(() => {
    setShown(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (!video.current?.paused) setShown(false); }, 2600);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  // The frame under the pointer, once it rests a moment (each one is a small ffmpeg job, cached).
  useEffect(() => {
    if (!hover) { setPreview(null); return; }
    const t = setTimeout(() => setPreview(Math.floor(hover.t / 10) * 10), 220);
    return () => clearTimeout(t);
  }, [hover]);

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
    if (sub && sub !== "off") lastSub.current = sub;
    setSub(href);
    const t = info?.subtitles.find((s) => s.href === href);
    remember({ audio: choice?.audio ?? null, subtitle: href === "off" ? "off" : { lang: t?.lang ?? null, label: t?.label ?? null } });
  }

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play(); else v.pause();
  }, []);
  const skip = useCallback((d: number) => {
    const v = video.current;
    if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d));
  }, []);
  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrap.current?.requestFullscreen?.();
  }, []);
  function setVol(x: number) {
    const v = video.current;
    const level = Math.max(0, Math.min(1, x));
    setVolume(level);
    setMuted(level === 0);
    if (v) { v.volume = level; v.muted = level === 0; }
    try { localStorage.setItem("volume", String(level)); } catch { /* private mode */ }
  }
  function toggleMute() {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  // Keys: space or k plays, the arrows (or j and l) move ten seconds, f fullscreen, m mute, c subtitles.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === " " || k === "k") { e.preventDefault(); toggle(); }
      else if (k === "arrowleft" || k === "j") skip(-10);
      else if (k === "arrowright" || k === "l") skip(10);
      else if (k === "f") fullscreen();
      else if (k === "m") toggleMute();
      else if (k === "c" && info?.subtitles.length) pickSubtitle(sub && sub !== "off" ? "off" : lastSub.current ?? info.subtitles[0]!.href);
      else if (k === "escape" && !document.fullscreenElement) go(`#/w/${id}`);
      else return;
      poke();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  function onLoaded() {
    const v = video.current;
    applySubtitle();
    if (!v) return;
    v.volume = volume;
    setLength(v.duration);
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
    setNow(v.currentTime);
    if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
    const t = Date.now();
    if (t - lastSave.current > 10_000) {
      lastSave.current = t;
      void saveProgress(id, unitKey, v.currentTime, v.duration);
    }
  }

  function onPause() {
    setPlaying(false);
    setShown(true);
    const v = video.current;
    if (v && v.duration) void saveProgress(id, unitKey, v.currentTime, v.duration);
  }

  function onEnded() {
    const v = video.current;
    if (v) void saveProgress(id, unitKey, v.duration, v.duration);
    if (next) setCountdown(8);
  }

  /** Where on the scrubber a pointer is, as seconds. */
  const at = (clientX: number) => {
    const r = scrub.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, clientX - r.left));
    return { x, t: (x / Math.max(1, r.width)) * (length || 0) };
  };
  function scrubDown(e: React.PointerEvent) {
    const v = video.current;
    if (!v || !length) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    v.currentTime = at(e.clientX).t;
    setNow(v.currentTime);
  }
  function scrubMove(e: React.PointerEvent) {
    if (!length) return;
    const h = at(e.clientX);
    setHover(h);
    if (e.buttons === 1 && video.current) { video.current.currentTime = h.t; setNow(h.t); }
  }

  // On a phone: a tap shows or hides the controls; two quick taps on a side move ten seconds.
  function tapStage(e: React.PointerEvent) {
    if (e.pointerType === "mouse") { toggle(); return; }
    const t = Date.now();
    const side = e.clientX < window.innerWidth / 2 ? "left" : "right";
    const prev = lastTap.current;
    if (prev && t - prev.t < 300 && (prev.x < window.innerWidth / 2) === (side === "left")) {
      skip(side === "left" ? -10 : 10);
      setFlash({ side, key: t });
      lastTap.current = null;
      return;
    }
    lastTap.current = { t, x: e.clientX };
    setTimeout(() => { if (lastTap.current?.t === t) { if (shown) setShown(false); else poke(); } }, 280);
  }

  const tracks = !!info && (info.audios.length > 1 || info.subtitles.length > 0);
  const src = `${base}/video${info?.audioTrack ? `?audio=${info.audioTrack}` : ""}`;
  const ready = !!info?.ready && info.allowed !== false;
  const share = length ? (now / length) * 100 : 0;

  return (
    <div ref={wrap} className={`player ${ready ? "live" : ""} ${shown || !playing ? "" : "calm"}`} onPointerMove={(e) => e.pointerType === "mouse" && poke()}>
      <div className="player-top">
        <a className="back" href={`#/w/${id}`} aria-label="Volver a la obra"><Icon name="back" /></a>
        <div className="player-title">
          <strong>{work?.title ?? ""}</strong>
          {unit && work?.type !== "film" && <span>{unit.label}</span>}
        </div>
        <div className="menu-wrap">
          {tracks && (
            <button className={`ctl ${panel ? "on" : ""}`} onClick={() => setPanel(!panel)} aria-haspopup="dialog" aria-expanded={panel} title="Audio y subtítulos">
              <Icon name="captions" />
            </button>
          )}
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

      {error && <p className="notice bad player-notice">{error}</p>}
      {!info && !error && <div className="reader-loading"><div className="spinner" aria-label="Cargando" /></div>}
      {info?.allowed === false && (
        <div className="preparing">
          <Icon name="wifi" className="icon big-icon" />
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

      {ready && (
        <>
          <video key={src} ref={video} src={src} autoPlay playsInline preload="metadata"
                 onLoadedMetadata={onLoaded} onTimeUpdate={onTime} onPause={onPause} onEnded={onEnded}
                 onPlay={() => { setPlaying(true); setWaiting(false); poke(); }} onWaiting={() => setWaiting(true)} onPlaying={() => setWaiting(false)}
                 onDurationChange={(e) => setLength(e.currentTarget.duration)} onVolumeChange={(e) => setMuted(e.currentTarget.muted)}>
            {info!.subtitles.map((s, i) => <track key={s.href} kind="subtitles" src={s.href} srcLang={s.lang ?? undefined} label={subLabel(s, i)} />)}
          </video>
          <div className="stage-tap" onPointerUp={tapStage} />
          {flash && <span key={flash.key} className={`skip-flash ${flash.side}`}><Icon name={flash.side === "left" ? "back" : "next"} />10 s</span>}
          {waiting && <div className="spinner player-spinner" aria-label="Cargando" />}
          {!playing && !waiting && (
            <button className="big-play" onClick={toggle} aria-label="Reproducir"><Icon name="play" /></button>
          )}
          <div className="player-bottom">
            <div ref={scrub} className="scrub" role="slider" aria-label="Posición" aria-valuemin={0} aria-valuemax={Math.round(length)} aria-valuenow={Math.round(now)}
                 aria-valuetext={clock(now)} tabIndex={0} onPointerDown={scrubDown} onPointerMove={scrubMove} onPointerLeave={() => setHover(null)}>
              <div className="scrub-track">
                <div className="scrub-buffered" style={{ width: `${length ? (buffered / length) * 100 : 0}%` }} />
                <div className="scrub-played" style={{ width: `${share}%` }} />
              </div>
              <div className="scrub-thumb" style={{ left: `${share}%` }} />
              {hover && (
                <div className="scrub-hover" style={{ left: `${hover.x}px` }}>
                  {preview !== null && <img src={`${base}/frame?t=${preview}&w=320`} alt="" />}
                  <span>{clock(hover.t)}</span>
                </div>
              )}
            </div>
            <div className="ctl-row">
              <button className="ctl" onClick={toggle} aria-label={playing ? "Pausa" : "Reproducir"} title={playing ? "Pausa (espacio)" : "Reproducir (espacio)"}>
                {playing ? <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></svg>
                  : <Icon name="play" />}
              </button>
              <button className="ctl" onClick={() => skip(-10)} aria-label="Diez segundos atrás" title="10 s atrás (←)"><Icon name="back" /><small>10</small></button>
              <button className="ctl" onClick={() => skip(10)} aria-label="Diez segundos adelante" title="10 s adelante (→)"><small>10</small><Icon name="next" /></button>
              <div className="volume">
                <button className="ctl" onClick={toggleMute} aria-label={muted ? "Activar el sonido" : "Silenciar"} title="Silenciar (m)">
                  <VolumeIcon level={volume} muted={muted} />
                </button>
                <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => setVol(Number(e.target.value))} aria-label="Volumen" />
              </div>
              <span className="time">{clock(now)} <span className="faint">/ {clock(length)}</span></span>
              <span className="grow" />
              {next && (
                <a className="ctl next-ep" href={`#/v/${id}/${next.key}`} title={`Siguiente: ${next.label}`}>
                  <Icon name="next" /><span className="label">{next.label}</span>
                </a>
              )}
              <button className="ctl" onClick={fullscreen} aria-label={full ? "Salir de pantalla completa" : "Pantalla completa"} title="Pantalla completa (f)">
                <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
                  {full ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
                </svg>
              </button>
            </div>
          </div>
        </>
      )}
      {countdown !== null && next && (
        <div className="next-up">
          <Img src={`${unitPath(id, next.key)}/frame?at=0.12&w=320`} />
          <div>
            <span className="faint small">A continuación, en {countdown} s</span>
            <strong>{next.label}</strong>
            <div className="row">
              <a className="btn primary" href={`#/v/${id}/${next.key}`}><Icon name="play" /> Ver ahora</a>
              <button onClick={() => setCountdown(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A small image that hides itself if it fails (the next episode's frame). */
function Img({ src }: { src: string }) {
  const [ok, setOk] = useState(true);
  return ok ? <img src={src} alt="" onError={() => setOk(false)} /> : null;
}
