import { cpSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * pdf.js fetches its fonts, CMaps, colour profiles and image decoders at run time. They are copied
 * from the package into web/public/pdfjs/ (not committed), so the book viewer gets them from this
 * server and the CSP stays 'self'.
 */
function pdfjsAssets(): Plugin {
  return {
    name: "archivist:pdfjs-assets",
    configResolved(config) {
      const from = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
      const to = join(config.root, "public", "pdfjs");
      for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) cpSync(join(from, dir), join(to, dir), { recursive: true });
    },
  };
}

export default defineConfig({
  root: "web",
  plugins: [react(), pdfjsAssets()],
  build: { outDir: "../dist/web", emptyOutDir: true, sourcemap: false },
  server: { proxy: { "/api": "http://127.0.0.1:8780" } },
});
