import { useEffect, useRef, useState } from "react";
import { ask, type AskTurn } from "../api.ts";
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
  const [error, setError] = useState("");
  const [model, setModel] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setLines([]); setError(""); setQuote(null); }, [id, unitKey]);
  // A new selection on the page becomes the fragment the next question is about.
  useEffect(() => {
    if (!selected?.text.trim()) return;
    setQuote(selected.text.trim().replace(/\s+/g, " ").slice(0, QUOTE_CHARS));
    if (!touchScreen()) box.current?.focus();
  }, [selected?.n, selected?.text]);
  // Keep the last question at the top, so a long answer is read from its first line.
  useEffect(() => {
    const asked = list.current?.querySelectorAll<HTMLElement>(".ask-line.user");
    const last = asked?.[asked.length - 1];
    if (last && list.current) list.current.scrollTop = last.offsetTop - 8;
  }, [lines, busy]);
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
    // On a phone: the keyboard away and the whole screen for the answer.
    if (onTall) { box.current?.blur(); onTall(true); }
    try {
      const a = await ask(id, unitKey, page, content, history);
      setModel(a.model);
      setLines((l) => [...l, { role: "assistant", content: a.answer }]);
    } catch (e) {
      setError(spanish(String((e as Error).message)));
    } finally {
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
      <div className="ask-lines" ref={list}>
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
        {busy && <div className="ask-line assistant pending"><p>Leyendo y pensando…</p></div>}
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
        <button className="btn primary" type="submit" disabled={busy || (!draft.trim() && !quote)} aria-label="Enviar"><Icon name="send" /></button>
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
  if (/is off/.test(msg)) return "El asistente está apagado en el servidor.";
  return `El modelo no respondió (${msg}).`;
}
