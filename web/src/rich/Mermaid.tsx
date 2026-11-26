import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { CodeBlock, CopyButton } from "./code.tsx";

// The archivist palette, so a diagram looks like part of the panel and not a pasted image.
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",   // labels are sanitized, no clicks, no scripts
  theme: "base",
  darkMode: true,
  htmlLabels: false,         // labels as SVG text: nothing for the sanitizer to let through
  fontFamily: '"Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif',
  themeVariables: {
    darkMode: true,
    background: "#15151b",
    fontSize: "14px",
    primaryColor: "#2a2316",
    primaryBorderColor: "#f0b54d",
    primaryTextColor: "#f3f0e8",
    secondaryColor: "#1d2330",
    secondaryBorderColor: "#7fa8e0",
    secondaryTextColor: "#f3f0e8",
    tertiaryColor: "#1b2620",
    tertiaryBorderColor: "#7fd49b",
    tertiaryTextColor: "#f3f0e8",
    lineColor: "#cfcbc0",
    textColor: "#f3f0e8",
    mainBkg: "#2a2316",
    nodeBorder: "#f0b54d",
    clusterBkg: "#1a1a21",
    clusterBorder: "rgba(255,255,255,0.2)",
    edgeLabelBackground: "#15151b",
    actorBkg: "#2a2316",
    actorBorder: "#f0b54d",
    actorTextColor: "#f3f0e8",
    signalColor: "#cfcbc0",
    signalTextColor: "#f3f0e8",
    labelBoxBkgColor: "#2a2316",
    labelBoxBorderColor: "#f0b54d",
    noteBkgColor: "#1d2330",
    noteBorderColor: "#7fa8e0",
    noteTextColor: "#f3f0e8",
  },
});

let seq = 0;

/** A Mermaid block drawn as SVG; when the model's diagram does not parse, the code is shown instead. */
export default function Mermaid({ code }: { code: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"drawing" | "ok" | "bad">("drawing");

  useEffect(() => {
    let live = true;
    const id = `archivist-mermaid-${++seq}`;
    (async () => {
      try {
        if (!(await mermaid.parse(code, { suppressErrors: true }))) throw new Error("does not parse");
        const { svg } = await mermaid.render(id, code);
        if (!live || !box.current) return;
        box.current.innerHTML = svg;   // Mermaid's own SVG, built in strict mode
        const el = box.current.querySelector("svg");
        el?.removeAttribute("height");
        el?.setAttribute("role", "img");
        setState("ok");
      } catch {
        if (live) setState("bad");
      } finally {
        // The scratch nodes Mermaid leaves on the page on an error. The drawn SVG carries the same id,
        // so only a node outside this figure is removed.
        for (const stray of [document.getElementById(id), document.getElementById(`d${id}`)]) {
          if (stray && !box.current?.contains(stray)) stray.remove();
        }
      }
    })();
    return () => { live = false; };
  }, [code]);

  if (state === "bad") return <CodeBlock lang="mermaid" text={code} />;
  return (
    <figure className={`md-diagram ${state}`}>
      <div ref={box} className="md-diagram-svg" aria-label="Diagrama" />
      {state === "drawing" && <p className="md-rich-wait">Dibujando el diagrama…</p>}
      {state === "ok" && (
        <figcaption>
          <details>
            <summary>Ver código</summary>
            <pre><code>{code}</code></pre>
            <CopyButton text={code} />
          </details>
        </figcaption>
      )}
    </figure>
  );
}
