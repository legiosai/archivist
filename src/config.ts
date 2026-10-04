/** Settings from the environment. A non-loopback address without a token is refused. */
import { BlockList, isIP } from "node:net";
import { resolve } from "node:path";

export interface Config {
  library: string;
  data: string;
  host: string;
  port: number;
  token: string | null;
  web: string;
  backup: string | null;
  /** Networks whose requests need no token (ARCHIVIST_TRUSTED); none unless configured. */
  trusted: BlockList;
  /** Serve video to requests that came through a reverse proxy (ARCHIVIST_PROXIED_VIDEO=on). */
  proxiedVideo?: boolean;
  /** More names that reach this server from a trusted network (ARCHIVIST_HOSTS), beyond the usual ones. */
  hosts?: string[];
}

/** Shorthands for ARCHIVIST_TRUSTED, plus any CIDR ("192.168.1.0/24"). */
export const NETWORKS: Record<string, string[]> = {
  loopback: ["127.0.0.0/8", "::1/128"],
  tailscale: ["100.64.0.0/10", "fd7a:115c:a1e0::/48"],
  lan: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7", "fe80::/10"],
};

export function trustedNetworks(spec: string | undefined): BlockList {
  const list = new BlockList();
  const items = (spec ?? "").split(/[\s,]+/).filter(Boolean);
  for (const item of items) {
    for (const cidr of NETWORKS[item.toLowerCase()] ?? [item]) {
      const [net, bits] = cidr.split("/");
      const family = isIP(net ?? "");
      if (!family || !bits || Number.isNaN(Number(bits))) throw new Error(`ARCHIVIST_TRUSTED: not a network: ${cidr}`);
      list.addSubnet(net!, Number(bits), family === 6 ? "ipv6" : "ipv4");
    }
  }
  return list;
}

/** Is this socket address inside a trusted network? IPv4-mapped IPv6 counts as IPv4. */
export function isTrusted(list: BlockList, address: string | undefined): boolean {
  if (!address) return false;
  const a = address.startsWith("::ffff:") && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
  const family = isIP(a);
  return family !== 0 && list.check(a, family === 6 ? "ipv6" : "ipv4");
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
    backup: env.ARCHIVIST_BACKUP_DIR ? resolve(env.ARCHIVIST_BACKUP_DIR) : null,
    trusted: trustedNetworks(env.ARCHIVIST_TRUSTED),
    proxiedVideo: /^(1|on|true|yes)$/i.test(env.ARCHIVIST_PROXIED_VIDEO ?? ""),
    hosts: (env.ARCHIVIST_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
  };
}
