import { useState } from "react";

/**
 * Put text on the clipboard. The Clipboard API exists only on secure pages (https, localhost);
 * on the home network archivist is plain http, so fall back to a hidden textarea and execCommand.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the old way */ }
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
  document.body.appendChild(box);
  box.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  box.remove();
  return ok;
}

/** A button that copies `text` and says so for a moment. */
export function CopyButton({ text, label = "Copiar", className = "" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"" | "ok" | "fail">("");
  async function copy() {
    setState((await copyText(text)) ? "ok" : "fail");
    setTimeout(() => setState(""), 1600);
  }
  return (
    <button type="button" className={`md-copy ${className}`} onClick={() => void copy()} aria-live="polite">
      {state === "ok" ? "Copiado" : state === "fail" ? "No se pudo" : label}
    </button>
  );
}

const LANG_NAMES: Record<string, string> = {
  sh: "shell", bash: "bash", zsh: "zsh", console: "terminal", shell: "shell", py: "python", js: "javascript", ts: "typescript",
  yml: "yaml", md: "markdown", text: "texto", txt: "texto", plaintext: "texto",
};

/** Fenced code: the language on top, a copy button, and the code as written. */
export function CodeBlock({ lang, text }: { lang: string; text: string }) {
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{LANG_NAMES[lang] ?? (lang || "código")}</span>
        <CopyButton text={text} />
      </div>
      <pre><code>{text}</code></pre>
    </div>
  );
}
