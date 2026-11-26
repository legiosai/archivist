import { useEffect, useRef, useState, type ReactNode } from "react";
import { ask, type AskTurn } from "../api.ts";
import { Icon } from "../icons.tsx";

interface Line extends AskTurn {
  /** The page the question was asked on. */
  page?: number;
}

const STARTERS = ["Explicame esta página con palabras simples", "Dame un ejemplo concreto de esto", "¿Qué tengo que recordar de acá?"];

/** `code`, **strong** and *emphasis* inside a line; anything else stays as written. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*)/g).map((part, i) => {
    if (/^`.+`$/.test(part)) return <code key={i}>{part.slice(1, -1)}</code>;
    if (/^\*\*.+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^\*.+\*$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

/**
 * An answer as the model wrote it: paragraphs, fenced code as a block, and the little Markdown
 * models use whatever they are told. Built as elements, never as HTML.
 */
function Answer({ text }: { text: string }) {
  return (
    <>
      {text.split(/```[a-z]*\n?/i).map((block, i) => (i % 2
        ? <pre key={i}>{block.replace(/\n$/, "")}</pre>
        : block.trim() ? <p key={i}>{inline(block.trim().replace(/^#{1,4}\s+/gm, ""))}</p> : null))}
    </>
  );
}

/**
 * A conversation about the page on screen. Each question goes with the page it was asked on; the
 * server sends the model that page and the two before it, never one further on.
 */
export function AskPanel({ id, unitKey, page, onClose }: { id: string; unitKey: string; page: number; onClose: () => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [model, setModel] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setLines([]); setError(""); }, [id, unitKey]);
  // Keep the last question at the top, so a long answer is read from its first line.
  useEffect(() => {
    const asked = list.current?.querySelectorAll<HTMLElement>(".ask-line.user");
    const last = asked?.[asked.length - 1];
    if (last && list.current) list.current.scrollTop = last.offsetTop - 8;
  }, [lines, busy]);
  useEffect(() => { box.current?.focus(); }, []);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const history = lines.map(({ role, content }) => ({ role, content }));
    setLines([...lines, { role: "user", content: question, page }]);
    setDraft("");
    setError("");
    setBusy(true);
    try {
      const a = await ask(id, unitKey, page, question, history);
      setModel(a.model);
      setLines((l) => [...l, { role: "assistant", content: a.answer }]);
    } catch (e) {
      setError(spanish(String((e as Error).message)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="ask" aria-label="Preguntar sobre esta página">
      <header>
        <strong>Preguntar</strong>
        <span className="pill">página {page}</span>
        <button className="ctl" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button>
      </header>
      <div className="ask-lines" ref={list}>
        {!lines.length && (
          <div className="ask-empty">
            <p>Preguntá lo que no se entienda de lo que estás leyendo.</p>
            {STARTERS.map((s) => <button key={s} className="ask-starter" onClick={() => void send(s)}>{s}</button>)}
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={`ask-line ${l.role}`}>
            {l.role === "user" && l.page ? <span className="ask-page">p. {l.page}</span> : null}
            {l.role === "assistant" ? <Answer text={l.content} /> : <p>{l.content}</p>}
          </div>
        ))}
        {busy && <div className="ask-line assistant pending"><p>Leyendo la página…</p></div>}
        {error && <p className="notice bad">{error}</p>}
      </div>
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
        <textarea ref={box} value={draft} rows={2} placeholder="Tu pregunta" aria-label="Tu pregunta" maxLength={2000}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); } }} />
        <button className="btn primary" type="submit" disabled={busy || !draft.trim()} aria-label="Enviar"><Icon name="send" /></button>
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
