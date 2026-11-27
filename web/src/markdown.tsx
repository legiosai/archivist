import { lazy, Suspense, type ReactNode } from "react";
import { isAnswersHeading, parseBlocks, parseChart, parseInline, plain, type Block, type Inline } from "./markdown-parse.ts";
import { CodeBlock } from "./rich/code.tsx";
import "./ask.css";

// Diagrams, charts and math load only when an answer has one, so the rest of the app stays light.
const Mermaid = lazy(() => import("./rich/Mermaid.tsx"));
const Chart = lazy(() => import("./rich/Chart.tsx"));
const TeX = lazy(() => import("./rich/TeX.tsx"));

function inlines(xs: Inline[], key = ""): ReactNode[] {
  return xs.map((x, i) => {
    const k = `${key}${i}`;
    switch (x.t) {
      case "text": return x.v;
      case "br": return <br key={k} />;
      case "code": return <code key={k}>{x.v}</code>;
      case "math": return <Suspense key={k} fallback={<code className="md-math-wait">{x.v}</code>}><TeX tex={x.v} /></Suspense>;
      case "strong": return <strong key={k}>{inlines(x.c, `${k}.`)}</strong>;
      case "em": return <em key={k}>{inlines(x.c, `${k}.`)}</em>;
      case "del": return <del key={k}>{inlines(x.c, `${k}.`)}</del>;
      case "link": return <span key={k} className="md-link">{inlines(x.c, `${k}.`)}</span>;
    }
  });
}

const Text = ({ text }: { text: string }) => <>{inlines(parseInline(text))}</>;

/** "> **Para recordar:** …" is the one idea worth keeping: drawn as a card, not a quote. */
function isTakeaway(b: Extract<Block, { t: "quote" }>): boolean {
  const first = b.blocks[0];
  return !!first && first.t === "p" && /^(para recordar|en resumen|clave|idea clave|key takeaway|to remember)\s*:?/i.test(plain(first.text));
}

function BlockView({ b }: { b: Block }): ReactNode {
  switch (b.t) {
    case "p": return <p><Text text={b.text} /></p>;
    case "h": {
      const Tag = (b.level <= 2 ? "h3" : b.level === 3 ? "h4" : "h5") as "h3" | "h4" | "h5";
      return <Tag className="md-h"><Text text={b.text} /></Tag>;
    }
    case "hr": return <hr />;
    case "code": {
      if (b.lang === "mermaid") return <Suspense fallback={<p className="md-rich-wait">Dibujando el diagrama…</p>}><Mermaid code={b.text} /></Suspense>;
      if (b.lang === "chart") {
        const spec = parseChart(b.text);
        return spec ? <Suspense fallback={<p className="md-rich-wait">Armando el gráfico…</p>}><Chart spec={spec} /></Suspense> : <CodeBlock lang="json" text={b.text} />;
      }
      if (b.lang === "math" || b.lang === "latex" || b.lang === "tex") return <Suspense fallback={<pre>{b.text}</pre>}><TeX tex={b.text} block /></Suspense>;
      return <CodeBlock lang={b.lang} text={b.text} />;
    }
    case "math": return <Suspense fallback={<pre>{b.text}</pre>}><TeX tex={b.text} block /></Suspense>;
    case "quote": return isTakeaway(b)
      ? <aside className="md-takeaway"><Blocks blocks={b.blocks} /></aside>
      : <blockquote><Blocks blocks={b.blocks} /></blockquote>;
    case "list": {
      const items = b.items.map((it, i) => <li key={i}><Text text={it.text} />{it.children.length > 0 && <Blocks blocks={it.children} />}</li>);
      return b.ordered ? <ol start={b.start === 1 ? undefined : b.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case "table": return (
      <div className="md-table-wrap">
        <table>
          <thead><tr>{b.head.map((h, i) => <th key={i} style={b.align[i] ? { textAlign: b.align[i]! } : undefined}><Text text={h} /></th>)}</tr></thead>
          <tbody>{b.rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci} style={b.align[ci] ? { textAlign: b.align[ci]! } : undefined}><Text text={c} /></td>)}</tr>
          ))}</tbody>
        </table>
      </div>
    );
  }
}

/** A diagram, a chart or a formula: something drawn from its source, which half-written draws nothing. */
const isDrawn = (b: Block) => b.t === "math" || (b.t === "code" && /^(mermaid|chart|math|latex|tex)$/.test(b.lang));

function Blocks({ blocks, live = false }: { blocks: Block[]; live?: boolean }) {
  // A quiz keeps its answers folded: everything after a "Respuestas" heading opens on request.
  const at = blocks.findIndex((b) => b.t === "h" && isAnswersHeading(b.text));
  const shown = at < 0 ? blocks : blocks.slice(0, at);
  // While the answer is still being written, its last block may be half of a diagram: it waits.
  const waiting = live && at < 0 && shown.length > 0 && isDrawn(shown[shown.length - 1]!);
  return (
    <>
      {shown.map((b, i) => (waiting && i === shown.length - 1
        ? <p key={i} className="md-rich-wait">Dibujando…</p>
        : <BlockView key={i} b={b} />))}
      {at >= 0 && (
        <details className="md-answers">
          <summary>Ver respuestas</summary>
          {blocks.slice(at + 1).map((b, i) => <BlockView key={i} b={b} />)}
        </details>
      )}
    </>
  );
}

/**
 * An answer as the model wrote it, built as elements: the model formats, it never injects.
 * `live` while it is still being written: what is there is shown, and a drawing waits for its end.
 */
export function Markdown({ text, live = false }: { text: string; live?: boolean }) {
  return <div className={`md ${live ? "md-live" : ""}`}><Blocks blocks={parseBlocks(text)} live={live} /></div>;
}
