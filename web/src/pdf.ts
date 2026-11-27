// pdf.js, loaded only when a book is opened: the library, its worker and the viewer parts (the
// same ones Firefox's PDF viewer is built from). Its fonts, CMaps and decoders are copied to
// /pdfjs/ at build time (vite.config.ts), so nothing comes from another origin.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { columnOf, samplePages, type Spans } from "./column.ts";

// The viewer module reads the library from this global when it is evaluated.
(globalThis as { pdfjsLib?: unknown }).pdfjsLib = pdfjs;
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy } from "pdfjs-dist";

/** The viewer parts; imported after the global above is set. */
export const viewerKit = () => import("pdfjs-dist/web/pdf_viewer.mjs");

export function openPdf(url: string) {
  return pdfjs.getDocument({
    url,
    withCredentials: true,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
  });
}

/** Above and below these fractions of a page's height there is only its head and its foot. */
const HEAD = 0.055, FOOT = 0.92;

/**
 * The column the book's words sit in, as [left, right] in fractions of the page's width, from the
 * text of a few pages spread over the book (column.ts). `null` when the pages have no text; it
 * throws when the pages could not be read at all.
 */
export async function textColumn(doc: pdfjs.PDFDocumentProxy, near: number, alive: () => boolean): Promise<[number, number] | null> {
  const pages: Spans[] = [];
  const picked = samplePages(doc.numPages, near);
  let unread = 0;
  for (const n of picked) {
    if (!alive()) return null;
    try {
      const page = await doc.getPage(n);
      const view = page.getViewport({ scale: 1 });
      const text = await page.getTextContent();
      const spans: Spans = [];
      for (const item of text.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const t = pdfjs.Util.transform(view.transform, item.transform) as number[];
        if (Math.abs(t[1]!) > Math.abs(t[0]!)) continue;   // text set sideways: not part of the column
        // The running head and the page number sit in the top and bottom margins, often out at the
        // sheet's edge: they are not what is being read, and would widen the column to the whole page.
        const y = t[5]! / view.height;
        if (y < HEAD || y > FOOT) continue;
        spans.push([t[4]! / view.width, (t[4]! + item.width) / view.width]);
      }
      pages.push(spans);
    } catch {
      unread++;
    }
  }
  // Pages that could not be read are not pages without text: say so, instead of "no column".
  if (unread > picked.length / 2) throw new Error("could not read the pages");
  return alive() ? columnOf(pages) : null;
}

/** Strings for the few labels pdf.js puts on pages; it would otherwise fetch locale files. */
export const quietL10n = {
  getLanguage: () => "es",
  getDirection: () => "ltr",
  get: async (ids: string | string[], _args?: unknown, fallback?: string) =>
    Array.isArray(ids) ? ids.map(() => fallback ?? "") : fallback ?? "",
  translate: async () => undefined,
  translateOnce: async () => undefined,
  pause: () => undefined,
  resume: () => undefined,
  destroy: async () => undefined,
};
