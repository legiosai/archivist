/**
 * OPDS 1.2 catalogs, so phone and tablet readers (Panels, Chunky, KOReader, Mihon, …) can browse
 * the manga and comics and read them. Each volume offers its file (CBZ/PDF) to download, and
 * pages one by one through the Page Streaming Extension (PSE), which is how most readers stream.
 * Fetching a page through PSE also saves it as the owner's position, so reading on the phone
 * moves the same "continue" shelf as reading in the browser.
 */
import type { Store } from "./db.ts";
import type { Library } from "./library/index.ts";
import type { Work } from "./library/scan.ts";

const NAV = "application/atom+xml;profile=opds-catalog;kind=navigation";
const ACQ = "application/atom+xml;profile=opds-catalog;kind=acquisition";
const TYPES_ES: Record<string, string> = { manga: "Manga", comic: "Cómics" };
const FILE_TYPES: Record<string, string> = { cbz: "application/vnd.comicbook+zip", zip: "application/zip", pdf: "application/pdf" };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function feed(id: string, title: string, self: string, kind: "navigation" | "acquisition", entries: string[], updated: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog" xmlns:pse="http://vaemendis.net/opds-pse/ns">
  <id>${esc(id)}</id>
  <title>${esc(title)}</title>
  <updated>${updated}</updated>
  <author><name>archivist</name></author>
  <link rel="self" href="${esc(self)}" type="${kind === "navigation" ? NAV : ACQ}"/>
  <link rel="start" href="/opds" type="${NAV}"/>
${entries.join("\n")}
</feed>
`;
}

function navEntry(id: string, title: string, href: string, content: string, updated: string): string {
  return `  <entry>
    <id>${esc(id)}</id>
    <title>${esc(title)}</title>
    <updated>${updated}</updated>
    <content type="text">${esc(content)}</content>
    <link rel="subsection" href="${esc(href)}" type="${ACQ}"/>
  </entry>`;
}

const readable = (w: Work) => w.kind === "pages" && w.units.length > 0;

export function rootFeed(library: Library, now = new Date()): string {
  const at = now.toISOString();
  const works = library.list().filter(readable);
  const entries = [navEntry("urn:archivist:continue", "Seguir leyendo", "/opds/continue", "Lo último que leíste", at)];
  for (const t of ["manga", "comic"]) {
    const n = works.filter((w) => w.type === t).length;
    if (n) entries.push(navEntry(`urn:archivist:type:${t}`, TYPES_ES[t]!, `/opds/type/${t}`, `${n} obra(s)`, at));
  }
  entries.push(navEntry("urn:archivist:all", "Todo", "/opds/all", `${works.length} obra(s)`, at));
  return feed("urn:archivist:root", "archivist", "/opds", "navigation", entries, at);
}

function workEntry(w: Work, at: string): string {
  return `  <entry>
    <id>urn:archivist:work:${esc(w.id)}</id>
    <title>${esc(w.title)}</title>
    <updated>${at}</updated>
    <content type="text">${esc(`${TYPES_ES[w.type] ?? w.type}${w.year ? ` · ${w.year}` : ""} · ${w.units.length} tomo(s)`)}</content>
    <link rel="http://opds-spec.org/image" href="/api/v1/works/${esc(w.id)}/cover" type="image/jpeg"/>
    <link rel="http://opds-spec.org/image/thumbnail" href="/api/v1/works/${esc(w.id)}/cover" type="image/jpeg"/>
    <link rel="subsection" href="/opds/w/${esc(w.id)}" type="${ACQ}"/>
  </entry>`;
}

export function worksFeed(library: Library, store: Store, which: "all" | "continue" | string, now = new Date()): string {
  const at = now.toISOString();
  let works = library.list().filter(readable);
  let title = "Todo";
  if (which === "continue") {
    const order = store.latest().map((p) => p.workId);
    works = order.map((id) => library.get(id)).filter((w): w is Work => !!w && readable(w));
    title = "Seguir leyendo";
  } else if (which !== "all") {
    works = works.filter((w) => w.type === which);
    title = TYPES_ES[which] ?? which;
  }
  if (which !== "continue") works.sort((a, b) => a.title.localeCompare(b.title, "es"));
  return feed(`urn:archivist:${which}`, title, `/opds/${which === "all" || which === "continue" ? which : `type/${which}`}`,
    "navigation", works.map((w) => workEntry(w, at)), at);
}

/** One work: an entry per volume, with its file and a PSE stream that knows where you are. */
export function workFeed(w: Work, store: Store, counts: Map<string, number>, now = new Date()): string {
  const at = now.toISOString();
  const progress = new Map(store.forWork(w.id).map((p) => [p.unitKey, p]));
  const entries = w.units.map((u) => {
    const base = `/api/v1/units/${w.id}/${u.key}`;
    const p = progress.get(u.key);
    const count = counts.get(u.key) ?? 0;
    const last = p && !p.finished ? Math.max(0, p.position - 1) : 0;
    const file = FILE_TYPES[u.format]
      ? `\n    <link rel="http://opds-spec.org/acquisition" href="${esc(base)}/file" type="${FILE_TYPES[u.format]}"/>` : "";
    return `  <entry>
    <id>urn:archivist:unit:${esc(w.id)}:${esc(u.key)}</id>
    <title>${esc(`${w.title} · ${u.label}`)}</title>
    <updated>${p?.updatedAt ?? at}</updated>
    <content type="text">${esc(p ? (p.finished ? "Terminado" : `Página ${p.position} de ${p.total}`) : `${count} páginas`)}</content>
    <link rel="http://opds-spec.org/image" href="${esc(base)}/pages/1" type="image/jpeg"/>
    <link rel="http://opds-spec.org/image/thumbnail" href="${esc(base)}/pages/1" type="image/jpeg"/>${file}
    <link rel="http://vaemendis.net/opds-pse/stream" type="image/jpeg" href="/opds/pse/${esc(w.id)}/${esc(u.key)}/{pageNumber}" pse:count="${count}" pse:lastRead="${last}"/>
  </entry>`;
  });
  return feed(`urn:archivist:work:${w.id}`, w.title, `/opds/w/${w.id}`, "acquisition", entries, at);
}
