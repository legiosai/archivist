import { useEffect, useRef, useState } from "react";
import { askStream, type AskTurn } from "../api.ts";
import { Icon } from "../icons.tsx";
import { touchScreen } from "../keyboard.ts";
import { Markdown } from "../markdown.tsx";
import { CopyButton } from "../rich/code.tsx";

interface Line extends AskTurn {
  /** The page the question was asked on. */
  page?: number;
  /** What the reader typed, and the fragment they had selected, as they should see them again. */
  question?: string;
  quote?: string;
}

/**
 * Ways to study what is on screen. `{x}` becomes "esta página", or "este fragmento" when the reader
 * selected some text, so the same shortcut works for both.
 */
const AIDS: [label: string, prompt: string][] = [
  ["Explicámelo simple", "Explicame {x} con palabras simples, como si fuera la primera vez que lo veo."],
  ["Resumen en puntos", "Resumí {x} en 4 a 6 puntos clave."],
  ["Un ejemplo", "Dame un ejemplo concreto y práctico de lo que dice {x}."],
  ["Una analogía", "Explicá la idea principal de {x} con una analogía de la vida cotidiana."],
  ["Diagrama", "Mostrame {x} con un diagrama Mermaid chico y explicá en dos o tres puntos cómo leerlo."],
  ["Conceptos clave", "Armá un glosario breve con los términos técnicos de {x}: el término en negrita y su definición en una línea."],
  ["Poneme a prueba", "Haceme 3 preguntas cortas para ver si entendí {x}. Poné las respuestas al final, bajo el título ### Respuestas."],
];

const QUOTE_CHARS = 1500;

/** What goes to the model: the question, with the selected fragment in front when there is one. */
function withQuote(question: string, quote: string | null): string {
  if (!quote) return question;
  return `Sobre este fragmento de la página:\n"${quote}"\n\n${question || "Explicámelo."}`;
}

/**
 * A conversation about the page on screen. Each question goes with the page it was asked on; the
 * server sends the model that page and the two before it, never one further on.
 */
export function AskPanel({ id, unitKey, page, onClose, quote: selected = null, tall = false, onTall }: {
  id: string; unitKey: string; page: number; onClose: () => void;
  /** Text the reader selected on the page; `n` changes on every new selection so the same text can be sent twice. */
  quote?: { text: string; n: number } | null;
  /** On a phone the panel is a sheet over the lower half of the page, and can take the whole screen. */
  tall?: boolean;
  onTall?: (tall: boolean) => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The answer being written, as far as it has come; `null` before its first word. */
  const [live, setLive] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [model, setModel] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const writing = useRef<AbortController | null>(null);

  useEffect(() => { setLines([]); setError(""); setQuote(null); }, [id, unitKey]);
  // Leaving the book, or the panel, stops an answer that is still being written.
  useEffect(() => () => writing.current?.abort(), [id, unitKey]);
  // A new selection on the page becomes the fragment the next question is about.
  useEffect(() => {
    if (!selected?.text.trim()) return;
    setQuote(selected.text.trim().replace(/\s+/g, " ").slice(0, QUOTE_CHARS));
    if (!touchScreen()) box.current?.focus();
  }, [selected?.n, selected?.text]);
  // A new question goes to the top, so its answer is read from its first line. While the answer is
  // being written there is not yet enough of it to scroll that far: the list follows it until the
  // question reaches the top, and then stays. A reader who scrolls on their own is left alone.
  const asked = lines.reduce((n, l) => n + (l.role === "user" ? 1 : 0), 0);
  const following = useRef(true);
  useEffect(() => { following.current = true; }, [asked]);
  useEffect(() => {
    if (!following.current) return;
    const questions = list.current?.querySelectorAll<HTMLElement>(".ask-line.user");
    const last = questions?.[questions.length - 1];
    if (last && list.current) list.current.scrollTop = last.offsetTop - 8;
  }, [asked, live, lines.length]);
  // With a keyboard at hand, typing can start at once. On a phone, focusing would bring the keyboard
  // up over the page before the reader chose between typing and one of the ready-made questions.
  useEffect(() => { if (!touchScreen()) box.current?.focus(); }, []);

  async function send(text: string) {
    const question = text.trim();
    if ((!question && !quote) || busy) return;
    const content = withQuote(question, quote);
    const history = lines.map(({ role, content }) => ({ role, content }));
    setLines([...lines, { role: "user", content, page, question: question || "Explicámelo.", quote: quote ?? undefined }]);
    setDraft("");
    setQuote(null);
    setError("");
    setBusy(true);
    setLive(null);
    setThinking(false);
    // On a phone: the keyboard away and the whole screen for the answer.
    if (onTall) { box.current?.blur(); onTall(true); }
    const stop = new AbortController();
    writing.current = stop;
    // The pieces come many a second: the panel is redrawn at most a dozen times in one.
    let written = "";
    let paint: ReturnType<typeof setTimeout> | undefined;
    const keep = () => { if (written.trim()) setLines((l) => [...l, { role: "assistant", content: written.trim() }]); };
    try {
      const a = await askStream(id, unitKey, page, content, history, {
        onThinking: () => setThinking(true),
        onText: (piece) => {
          written += piece;
          paint ??= setTimeout(() => { paint = undefined; setLive(written); }, 80);
        },
      }, stop.signal);
      if (a.model) setModel(a.model);
      setLines((l) => [...l, { role: "assistant", content: a.answer }]);
    } catch (e) {
      // Stopped by the reader, or cut on the way: what was written stays, as far as it got.
      keep();
      if (!stop.signal.aborted) setError(spanish(String((e as Error).message)));
    } finally {
      clearTimeout(paint);
      if (writing.current === stop) writing.current = null;
      setLive(null);
      setThinking(false);
      setBusy(false);
    }
  }

  const about = quote ? "este fragmento" : "esta página";

  return (
    <aside className="ask" aria-label="Preguntar sobre esta página">
      <header>
        <strong>Preguntar</strong>
        <span className="pill">página {page}</span>
        {onTall && (
          <button className={`ctl ask-size ${tall ? "on" : ""}`} onClick={() => onTall(!tall)} aria-pressed={tall}
                  aria-label={tall ? "Achicar el panel" : "Agrandar el panel"} title={tall ? "Achicar el panel" : "Agrandar el panel"}>
            <Icon name="chevron" />
          </button>
        )}
        <button className="ctl" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button>
      </header>
      <div className="ask-lines" ref={list} onWheel={() => { following.current = false; }} onTouchMove={() => { following.current = false; }}>
        {!lines.length && (
          <div className="ask-empty">
            <p>Preguntá lo que no se entienda de lo que estás leyendo, o elegí una de las ayudas de abajo.</p>
            <p className="faint small">Si seleccionás un párrafo de la página, la pregunta va sobre ese fragmento.</p>
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={`ask-line ${l.role}`}>
            {l.role === "user" ? (
              <>
                {l.page ? <span className="ask-page">p. {l.page}</span> : null}
                {l.quote && <blockquote className="ask-quoted">{l.quote}</blockquote>}
                <p>{l.question ?? l.content}</p>
              </>
            ) : (
              <>
                <Markdown text={l.content} />
                <div className="ask-tools"><CopyButton text={l.content} label="Copiar respuesta" /></div>
              </>
            )}
          </div>
        ))}
        {busy && (live
          ? <div className="ask-line assistant"><Markdown text={live} live /></div>
          : <div className="ask-line assistant pending"><p>{thinking ? "Pensando la respuesta…" : "Leyendo la página…"}</p></div>)}
        {error && <p className="notice bad">{error}</p>}
      </div>
      <div className="ask-aids" role="toolbar" aria-label="Ayudas para estudiar">
        {AIDS.map(([label, prompt]) => (
          <button key={label} type="button" className="ask-aid" disabled={busy} onClick={() => void send(prompt.replace("{x}", about))}>{label}</button>
        ))}
      </div>
      {quote && (
        <div className="ask-quote-chip">
          <span>Sobre: «{quote.length > 140 ? `${quote.slice(0, 139)}…` : quote}»</span>
          <button type="button" className="ctl" onClick={() => setQuote(null)} aria-label="Quitar el fragmento"><Icon name="close" /></button>
        </div>
      )}
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
        <textarea ref={box} value={draft} rows={2} placeholder={quote ? "¿Qué querés saber de este fragmento?" : "Tu pregunta"}
                  aria-label="Tu pregunta" maxLength={2000}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); } }} />
        {busy
          ? <button className="btn ask-stop" type="button" onClick={() => writing.current?.abort()} aria-label="Detener la respuesta" title="Detener la respuesta"><Icon name="stop" /></button>
          : <button className="btn primary" type="submit" disabled={!draft.trim() && !quote} aria-label="Enviar"><Icon name="send" /></button>}
      </form>
      <p className="faint small ask-note">
        Se envían al modelo{model ? ` (${model})` : ""} tu pregunta, esta página y las dos anteriores. Nada más del libro.
      </p>
    </aside>
  );
}

/** The server's errors, as the reader should read them. */
function spanish(msg: string): string {
  if (/no text/.test(msg)) return "Estas páginas no tienen texto (¿un libro escaneado?): no hay nada para enviar.";
  if (/refused the key/.test(msg)) return "El modelo rechazó la clave. Revisá ARCHIVIST_ASSISTANT_KEY en el servidor.";
  if (/no credit/.test(msg)) return "La cuenta del modelo no tiene saldo.";
  if (/rate-limited/.test(msg)) return "El modelo está saturado. Probá de nuevo en un momento.";
  if (/too long/.test(msg)) return "El modelo tardó demasiado en responder. Probá de nuevo.";
  if (/could not be reached/.test(msg)) return "No se pudo llegar al modelo desde el servidor.";
  if (/stopped answering/.test(msg)) return "El modelo dejó de responder a mitad de camino.";
  if (/sent no answer/.test(msg)) return "El modelo no escribió ninguna respuesta. Probá de nuevo.";
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return "Se cortó la conexión con el servidor.";
  if (/is off/.test(msg)) return "El asistente está apagado en el servidor.";
  return `El modelo no respondió (${msg}).`;
}
