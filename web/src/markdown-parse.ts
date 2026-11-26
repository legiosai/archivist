// The little Markdown a model writes, read into plain data. No HTML is ever passed through: the
// renderer (markdown.tsx) builds every element itself, so a model can format but never inject.

export type Inline =
  | { t: "text"; v: string }
  | { t: "br" }
  | { t: "code"; v: string }
  | { t: "math"; v: string }
  | { t: "strong" | "em" | "del"; c: Inline[] }
  /** A link keeps its words and drops its target: nothing in an answer navigates. */
  | { t: "link"; c: Inline[] };

export type Align = "left" | "center" | "right" | null;

export interface ListItem {
  text: string;
  /** Whatever was indented under the item: a nested list, a code block, more paragraphs. */
  children: Block[];
}

export type Block =
  | { t: "p"; text: string }
  | { t: "h"; level: number; text: string }
  | { t: "code"; lang: string; text: string }
  | { t: "math"; text: string }
  | { t: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { t: "quote"; blocks: Block[] }
  | { t: "table"; head: string[]; align: Align[]; rows: string[][] }
  | { t: "hr" };

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>/;
const MARKER = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const MATH_OPEN = /^\s*(\$\$|\\\[)/;

const indentOf = (line: string) => line.length - line.trimStart().length;
const isTableRow = (line: string) => line.includes("|") && line.trim().length > 1;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function startsBlock(line: string, next: string | undefined): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || MARKER.test(line)
    || MATH_OPEN.test(line) || (isTableRow(line) && next !== undefined && TABLE_SEP.test(next) && next.includes("-"));
}

/** Remove the indentation the lines share. */
function dedent(lines: string[]): string[] {
  const widths = lines.filter((l) => l.trim()).map(indentOf);
  const cut = widths.length ? Math.min(...widths) : 0;
  return lines.map((l) => l.slice(Math.min(cut, indentOf(l))));
}

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1]!, close = new RegExp(`^\\s*${mark[0] === "`" ? "`" : "~"}{${mark.length},}\\s*$`);
      const body: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i]!)) body.push(lines[i++]!);
      i++;   // the closing fence (or the end, when the model forgot it)
      out.push({ t: "code", lang: fence[2]!.toLowerCase(), text: dedent(body).join("\n") });
      continue;
    }

    const math = MATH_OPEN.exec(line);
    if (math) {
      const end = math[1] === "$$" ? "$$" : "\\]";
      const first = line.trim().slice(2);
      if (first.endsWith(end) && first.length >= end.length) {   // $$ x $$ on one line
        out.push({ t: "math", text: first.slice(0, -end.length).trim() });
        i++;
        continue;
      }
      const body = first ? [first] : [];
      i++;
      while (i < lines.length && !lines[i]!.trim().endsWith(end)) body.push(lines[i++]!);
      if (i < lines.length) {
        const last = lines[i]!.trim().slice(0, -end.length);
        if (last) body.push(last);
        i++;
      }
      out.push({ t: "math", text: body.join("\n").trim() });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) { out.push({ t: "h", level: heading[1]!.length, text: heading[2]! }); i++; continue; }
    if (RULE.test(line)) { out.push({ t: "hr" }); i++; continue; }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s{0,3}>\s?/, ""));
      out.push({ t: "quote", blocks: parseBlocks(body.join("\n")) });
      continue;
    }

    const next = lines[i + 1];
    if (isTableRow(line) && next !== undefined && TABLE_SEP.test(next) && next.includes("-")) {
      const head = splitRow(line);
      const align: Align[] = splitRow(next).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim() && isTableRow(lines[i]!)) {
        const cells = splitRow(lines[i++]!);
        rows.push(head.map((_, k) => cells[k] ?? ""));
      }
      out.push({ t: "table", head, align: head.map((_, k) => align[k] ?? null), rows });
      continue;
    }

    const marker = MARKER.exec(line);
    if (marker) { i = readList(lines, i, out); continue; }

    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !(para.length && startsBlock(lines[i]!, lines[i + 1]))) para.push(lines[i++]!.trim());
    out.push({ t: "p", text: para.join("\n") });
  }
  return out;
}

/** A list from line `i`; returns the index after it. Deeper-indented lines belong to the item above. */
function readList(lines: string[], i: number, out: Block[]): number {
  const first = MARKER.exec(lines[i]!)!;
  const base = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const start = ordered ? Number.parseInt(first[2]!, 10) : 1;
  const items: { text: string; inner: string[] }[] = [];
  let lastBlank = false;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      // A blank line ends the list unless what follows still belongs to it.
      let j = i + 1;
      while (j < lines.length && !lines[j]!.trim()) j++;
      const after = lines[j];
      const m = after === undefined ? null : MARKER.exec(after);
      const sameList = m && m[1]!.length <= base + 1 && /\d/.test(m[2]!) === ordered;
      const nested = after !== undefined && indentOf(after) > base;
      if (!sameList && !nested) break;
      items.at(-1)?.inner.push("");
      lastBlank = true;
      i++;
      continue;
    }
    const m = MARKER.exec(line);
    if (m && m[1]!.length <= base + 1) {
      if (/\d/.test(m[2]!) !== ordered) break;   // a numbered list after bullets is a new list
      items.push({ text: m[3]!.trim(), inner: [] });
    } else if (indentOf(line) > base) {
      items.at(-1)!.inner.push(line);
    } else if (!lastBlank && items.length && !startsBlock(line, lines[i + 1])) {
      items.at(-1)!.text += `\n${line.trim()}`;   // a lazy continuation of the item's words
    } else {
      break;
    }
    lastBlank = false;
    i++;
  }
  out.push({
    t: "list", ordered, start,
    items: items.map((it) => {
      const inner = dedent(it.inner);
      // Lines that just continue the item's sentence stay with it; the rest is parsed as blocks.
      let k = 0;
      while (k < inner.length && inner[k]!.trim() && !startsBlock(inner[k]!, inner[k + 1])) k++;
      const text = [it.text, ...inner.slice(0, k).map((l) => l.trim())].join("\n");
      return { text, children: parseBlocks(inner.slice(k).join("\n")) };
    }),
  });
  return i;
}

// Code spans first, then math, then emphasis and links. `$…$` must hug its contents and not be
// followed by a digit, so "$5 and $10" and "$HOME y $PATH" stay text.
const INLINE = new RegExp([
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/.source,
  /\\\(([\s\S]+?)\\\)/.source,
  /\$(?=[^\s$])((?:\\\$|[^$\n])*?[^\s\\$])\$(?!\d)/.source,
  /\*\*(?=\S)([\s\S]*?\S)\*\*/.source,
  /(?<![\w])__(?=\S)([\s\S]*?\S)__(?![\w])/.source,
  /~~(?=\S)([\s\S]*?\S)~~/.source,
  /\*(?=[^\s*])((?:[^*\n]|\*\*[^*\n]+\*\*)*?[^\s*])\*/.source,
  /(?<![\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w])/.source,
  /\[([^\]\n]+)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.source,
].join("|"), "g");

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const text = (v: string) => {
    const parts = v.split("\n");
    parts.forEach((p, k) => {
      if (k) out.push({ t: "br" });
      if (p) out.push({ t: "text", v: p.replace(/\\([\\`*_{}[\]()#+\-.!$|~>])/g, "$1") });
    });
  };
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index! > last) text(s.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[2] !== undefined) out.push({ t: "code", v: m[2].length > 2 && m[2].startsWith(" ") && m[2].endsWith(" ") ? m[2].slice(1, -1) : m[2] });
    else if (m[3] !== undefined) out.push({ t: "math", v: m[3].trim() });
    else if (m[4] !== undefined) out.push({ t: "math", v: m[4] });
    else if (m[5] !== undefined) out.push({ t: "strong", c: parseInline(m[5]) });
    else if (m[6] !== undefined) out.push({ t: "strong", c: parseInline(m[6]) });
    else if (m[7] !== undefined) out.push({ t: "del", c: parseInline(m[7]) });
    else if (m[8] !== undefined) out.push({ t: "em", c: parseInline(m[8]) });
    else if (m[9] !== undefined) out.push({ t: "em", c: parseInline(m[9]) });
    else if (m[10] !== undefined) out.push({ t: "link", c: parseInline(m[10]) });
  }
  if (last < s.length) text(s.slice(last));
  return out;
}

/** The words of some inline Markdown, without the marks (for headings matched by meaning). */
export function plain(s: string): string {
  const flat = (xs: Inline[]): string => xs.map((x) => ("v" in x ? x.v : "c" in x ? flat(x.c) : " ")).join("");
  return flat(parseInline(s)).trim();
}

/** "Respuestas", "Soluciones", "Answers": the heading after which a quiz keeps its answers. */
export const isAnswersHeading = (text: string) => /^(las\s+)?(respuestas|soluciones|answers?|solutions?)\b/i.test(plain(text));

export interface ChartSpec {
  type: "bar" | "line" | "pie";
  title: string;
  labels: string[];
  series: { name: string; data: number[] }[];
  x: string;
  y: string;
}

const MAX_SERIES = 8;
const MAX_POINTS = 60;

/** A ```chart block's JSON, checked; null when it is not one we can draw. */
export function parseChart(source: string): ChartSpec | null {
  let raw: unknown;
  try { raw = JSON.parse(source); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const type = o.type === "line" || o.type === "pie" ? o.type : o.type === "bar" || o.type === undefined ? "bar" : null;
  if (!type) return null;
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 120) : typeof v === "number" ? String(v) : "");
  const labels = Array.isArray(o.labels) ? o.labels.slice(0, MAX_POINTS).map(str) : [];
  const rawSeries = Array.isArray(o.series) ? o.series
    : Array.isArray(o.data) ? [{ name: str(o.y) || str(o.title), data: o.data }] : [];
  const series = rawSeries.slice(0, MAX_SERIES).flatMap((s, k) => {
    if (!s || typeof s !== "object") return [];
    const r = s as Record<string, unknown>;
    if (!Array.isArray(r.data)) return [];
    const data = r.data.slice(0, MAX_POINTS).map((v) => (typeof v === "number" ? v : Number(v)));
    if (!data.length || data.some((v) => !Number.isFinite(v))) return [];
    return [{ name: str(r.name) || `Serie ${k + 1}`, data }];
  });
  if (!series.length) return null;
  const length = Math.max(...series.map((s) => s.data.length));
  const filled = Array.from({ length }, (_, k) => labels[k] ?? String(k + 1));
  if (type === "pie" && series[0]!.data.every((v) => v <= 0)) return null;
  return { type, title: str(o.title), labels: filled, series, x: str(o.x), y: str(o.y) };
}
