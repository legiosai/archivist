import { useEffect, useRef } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * LaTeX drawn by KaTeX into its own node. trust:false keeps \href, \url and the HTML commands off,
 * and the expansion limits keep a runaway macro from hanging the page.
 */
export default function TeX({ tex, block = false }: { tex: string; block?: boolean }) {
  const el = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!el.current) return;
    try {
      katex.render(tex, el.current, { displayMode: block, throwOnError: false, trust: false, strict: "ignore", maxExpand: 500, maxSize: 20, output: "htmlAndMathml" });
    } catch {
      el.current.textContent = tex;
    }
  }, [tex, block]);
  return block ? <div ref={el as React.RefObject<HTMLDivElement>} className="md-math-block" /> : <span ref={el as React.RefObject<HTMLSpanElement>} className="md-math" />;
}
