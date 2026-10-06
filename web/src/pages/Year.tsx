import { useEffect, useState } from "react";
import { AuthError, TYPE_LABEL, api, type WorkType, type YearStats } from "../api.ts";
import { Icon } from "../icons.tsx";
import { Avatar, useProfiles } from "../profiles.tsx";
import { Header, Img, thumb } from "./parts.tsx";

const MONTHS = ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const n = (x: number) => x.toLocaleString("es-AR");
const one = (x: number, singular: string, plural: string) => (x === 1 ? singular : plural);

/** "3 h 20 min", "45 min": time watched, as a person says it. */
function watched(seconds: number): { big: string; unit: string } {
  const h = seconds / 3600;
  if (h >= 10) return { big: n(Math.round(h)), unit: "horas mirando" };
  if (h >= 1) return { big: h.toLocaleString("es-AR", { maximumFractionDigits: 1 }), unit: one(Math.round(h * 10) / 10, "hora mirando", "horas mirando") };
  const m = Math.round(seconds / 60);
  return { big: n(m), unit: one(m, "minuto mirando", "minutos mirando") };
}

function amount(t: { seconds: number; pages: number }): string {
  const parts = [];
  if (t.seconds >= 60) parts.push(t.seconds >= 3600 ? `${(t.seconds / 3600).toLocaleString("es-AR", { maximumFractionDigits: 1 })} h` : `${Math.round(t.seconds / 60)} min`);
  if (t.pages) parts.push(`${n(t.pages)} ${one(t.pages, "página", "páginas")}`);
  return parts.join(" · ");
}

/** A profile's year: time watched and pages read, by month, what kept them busiest, and what they finished. */
export function Year({ onAuth }: { onAuth: () => void }) {
  const { me } = useProfiles();
  const [year, setYear] = useState(new Date().getFullYear());
  const [stats, setStats] = useState<YearStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setStats(null);
    api<YearStats>(`/api/v1/stats?year=${year}`).then(setStats)
      .catch((e) => (e instanceof AuthError ? onAuth() : setError(String(e.message))));
  }, [year, onAuth]);

  const years = stats ? [...new Set([new Date().getFullYear(), ...stats.years])].sort((a, b) => b - a) : [year];
  // One measure for a month's bar: an hour of video and sixty pages weigh the same.
  const weight = (m: { seconds: number; pages: number }) => m.seconds / 3600 + m.pages / 60;
  const peak = stats ? Math.max(0.0001, ...stats.byMonth.map(weight)) : 1;
  const best = stats ? stats.byMonth.map(weight).indexOf(Math.max(...stats.byMonth.map(weight))) : -1;
  const empty = stats && !stats.seconds && !stats.pages && !stats.unitsFinished;
  const time = stats ? watched(stats.seconds) : null;

  return (
    <>
      <Header />
      <main className="year">
        <section className="year-hero">
          <Avatar profile={me} size="lg" />
          <div>
            <span className="eyebrow">Tu año{me ? `, ${me.name}` : ""}</span>
            <h1>{year}</h1>
          </div>
          {years.length > 1 && (
            <div className="tabs year-tabs" role="tablist" aria-label="Año">
              {years.map((y) => (
                <button key={y} role="tab" aria-selected={y === year} className={y === year ? "on" : ""} onClick={() => setYear(y)}>{y}</button>
              ))}
            </div>
          )}
        </section>

        {error && <p className="notice bad">{error}</p>}
        {!stats && !error && <div className="year-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton year-skel" />)}</div>}

        {stats && empty && (
          <div className="empty"><p className="display">Todavía nada en {year}</p><p>Lo que leas o mires a partir de ahora va a aparecer acá.</p></div>
        )}

        {stats && !empty && (
          <>
            <div className="year-grid">
              <div className="big-stat hot"><Icon name="play" /><strong>{time!.big}</strong><span>{time!.unit}</span></div>
              <div className="big-stat"><Icon name="book" /><strong>{n(stats.pages)}</strong><span>{one(stats.pages, "página leída", "páginas leídas")}</span></div>
              <div className="big-stat"><Icon name="check" /><strong>{n(stats.unitsFinished)}</strong><span>{one(stats.unitsFinished, "tomo o episodio terminado", "tomos y episodios terminados")}</span></div>
              <div className="big-stat"><Icon name="library" /><strong>{n(stats.worksFinished.length)}</strong><span>{one(stats.worksFinished.length, "obra terminada", "obras terminadas")}</span></div>
              <div className="big-stat"><Icon name="calendar" /><strong>{n(stats.daysActive)}</strong><span>{one(stats.daysActive, "día con algo", "días con algo")}</span></div>
              <div className="big-stat"><Icon name="flame" /><strong>{n(stats.longestStreak)}</strong><span>la racha más larga, en días</span></div>
            </div>

            <h2>Mes a mes</h2>
            <div className="months" role="img" aria-label={best >= 0 ? `El mes con más actividad fue ${MONTH_NAMES[best]}` : "Actividad por mes"}>
              {stats.byMonth.map((m, i) => (
                <div key={i} className={`month ${i === best && weight(m) > 0 ? "best" : ""}`} title={`${MONTH_NAMES[i]}: ${amount(m) || "nada"}${m.finished ? ` · ${m.finished} terminados` : ""}`}>
                  <div className="month-bar"><div style={{ height: `${Math.max(weight(m) > 0 ? 4 : 0, (weight(m) / peak) * 100)}%` }} /></div>
                  <span>{MONTHS[i]}</span>
                </div>
              ))}
            </div>

            {stats.top.length > 0 && (
              <>
                <h2>Lo que más te tuvo</h2>
                <ol className="top-list">
                  {stats.top.map((t, i) => (
                    <li key={t.workId}>
                      <a href={`#/w/${t.work.id}`} className="top-item" style={{ "--i": i } as React.CSSProperties}>
                        <span className="top-rank">{i + 1}</span>
                        {t.work.cover ? <Img className="top-cover" src={thumb(t.work.cover, 160)} /> : <span className="top-cover placeholder">{t.work.title.slice(0, 1)}</span>}
                        <span className="top-text"><strong>{t.work.title}</strong><span className="faint">{TYPE_LABEL[t.work.type]} · {amount(t)}</span></span>
                      </a>
                    </li>
                  ))}
                </ol>
              </>
            )}

            {stats.worksFinished.length > 0 && (
              <>
                <h2>Terminaste</h2>
                <div className="grid finished-grid">
                  {stats.worksFinished.map((w, i) => (
                    <a key={w.id} className="tile" href={`#/w/${w.id}`} style={{ "--i": i } as React.CSSProperties}>
                      <div className="cover">
                        {w.cover ? <Img src={thumb(w.cover, 320)} /> : <span className="initial">{w.title.slice(0, 1)}</span>}
                        <span className="done-badge"><Icon name="check" /></span>
                      </div>
                      <strong>{w.title}</strong>
                    </a>
                  ))}
                </div>
              </>
            )}

            {Object.keys(stats.byType).length > 0 && (
              <p className="by-type faint">
                {Object.entries(stats.byType).map(([t, c]) => `${c} ${TYPE_LABEL[t as WorkType]?.toLowerCase() ?? t}${c === 1 ? "" : "s"}`).join(" · ")}
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}
