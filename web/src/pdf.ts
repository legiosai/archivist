// pdf.js, loaded only when a book is opened: the library, its worker and the viewer parts (the
// same ones Firefox's PDF viewer is built from). Its fonts, CMaps and decoders are copied to
// /pdfjs/ at build time (vite.config.ts), so nothing comes from another origin.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";

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
