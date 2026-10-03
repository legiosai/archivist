/** Settings from the environment. A non-loopback address without a token is refused. */
import { resolve } from "node:path";

export interface Config {
  library: string;
  data: string;
  host: string;
  port: number;
  token: string | null;
  web: string;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const library = env.ARCHIVIST_LIBRARY;
  if (!library) throw new Error("ARCHIVIST_LIBRARY is not set: the folder with video/, pages/ and stills/");
  const host = env.ARCHIVIST_HOST || "127.0.0.1";
  const token = env.ARCHIVIST_TOKEN?.trim() || null;
  if (!token && !LOOPBACK.has(host)) {
    throw new Error(`refusing to listen on ${host} without ARCHIVIST_TOKEN`);
  }
  return {
    library: resolve(library),
    data: resolve(env.ARCHIVIST_DATA || "data"),
    host,
    port: Number(env.ARCHIVIST_PORT || 8780),
    token,
    web: resolve(env.ARCHIVIST_WEB || new URL("../dist/web", import.meta.url).pathname),
  };
}
