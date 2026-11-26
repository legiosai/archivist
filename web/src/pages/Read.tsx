import { Suspense, lazy, useEffect, useState } from "react";
import { AuthError, api, useQuery, type WorkDetail } from "../api.ts";
import { Reader } from "./Reader.tsx";

// pdf.js is big: it loads only when a book is opened.
const Book = lazy(() => import("./Book.tsx"));

const Opening = () => <main className="reader-loading"><div className="spinner" aria-label="Abriendo" /></main>;

/**
 * A book in PDF opens in the PDF viewer (zoom, search, index, text to select); manga, comics and
 * everything else in the page reader. `?classic=1` opens a book in the page reader too.
 */
export function Read({ id, unitKey, onAuth }: { id: string; unitKey: string; onAuth: () => void }) {
  const classic = useQuery("classic") === "1";
  const [viewer, setViewer] = useState<"book" | "pages" | null>(null);

  useEffect(() => {
    setViewer(null);
    api<WorkDetail>(`/api/v1/works/${id}`)
      .then((w) => {
        const unit = w.unitList.find((u) => u.key === unitKey);
        setViewer(w.type === "book" && unit?.format === "pdf" ? "book" : "pages");
      })
      .catch((e) => (e instanceof AuthError ? onAuth() : setViewer("pages")));
  }, [id, unitKey, onAuth]);

  if (!viewer) return <Opening />;
  if (viewer === "book" && !classic) {
    return <Suspense fallback={<Opening />}><Book id={id} unitKey={unitKey} onAuth={onAuth} /></Suspense>;
  }
  return <Reader id={id} unitKey={unitKey} onAuth={onAuth} />;
}
