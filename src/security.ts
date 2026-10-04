/**
 * What changes when archivist is published behind a reverse proxy (a Cloudflare Tunnel, say):
 *
 * - The proxy connects from this machine, so the socket says 127.0.0.1. A request that arrives
 *   from loopback carrying CF-Connecting-IP or X-Forwarded-For is *proxied*: its client is the
 *   address in that header, and it is never on a trusted network, whatever ARCHIVIST_TRUSTED says.
 *   (Only a local process can reach loopback, so only the proxy can set those headers there.)
 * - Failed logins and wrong tokens are counted per client: past MAX_FAILURES in WINDOW_MS the
 *   client gets 429 until the window ends, and every failure is logged in one line that a log
 *   watcher (CrowdSec) can turn into a ban at the edge.
 * - A trusted network only counts when the request names this server the way a person at home
 *   would (an address, "localhost", "valensrv", a Tailscale or .local name, or ARCHIVIST_HOSTS).
 *   Otherwise a web page on any site could point its own domain at a LAN address (DNS
 *   rebinding) and read the library through the visitor's browser.
 * - Every response carries the usual hardening headers; HSTS only when the request came over HTTPS.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";

export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60_000;

export interface Client {
  ip: string;
  proxied: boolean;
  https: boolean;
}

const LOOPBACK = (a: string | undefined) => !!a && (a === "::1" || a.startsWith("127.") || a.startsWith("::ffff:127."));

function firstForwarded(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  const ip = s?.split(",")[0]?.trim();
  return ip && isIP(ip) ? ip : undefined;
}

export function clientOf(req: IncomingMessage): Client {
  const socket = req.socket.remoteAddress ?? "";
  const forwarded = LOOPBACK(socket)
    ? firstForwarded(req.headers["cf-connecting-ip"]) ?? firstForwarded(req.headers["x-forwarded-for"])
    : undefined;
  const proto = String(req.headers["x-forwarded-proto"] ?? "");
  const visitor = String(req.headers["cf-visitor"] ?? "");
  return {
    ip: forwarded ?? socket,
    proxied: forwarded !== undefined,
    https: forwarded !== undefined && (proto === "https" || visitor.includes('"https"')),
  };
}

const LOCAL_SUFFIXES = [".ts.net", ".local", ".lan", ".home.arpa", ".internal", ".localhost"];

/** Whether a Host header is one a person on the home network or the tailnet would type. */
export function localHost(header: string | undefined, extra: string[] = []): boolean {
  if (!header) return false;
  const h = header.toLowerCase();
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(h);
  const host = bracketed ? bracketed[1]! : h.replace(/:\d+$/, "");
  if (isIP(host) || host === "localhost" || extra.includes(host)) return true;
  if (!host.includes(".")) return /^[a-z0-9-]+$/.test(host);
  return LOCAL_SUFFIXES.some((s) => host.endsWith(s));
}

export class FailureLimiter {
  private readonly hits = new Map<string, { count: number; until: number }>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max = MAX_FAILURES, windowMs = WINDOW_MS) {
    this.max = max;
    this.windowMs = windowMs;
  }

  blocked(ip: string, now = Date.now()): boolean {
    const h = this.hits.get(ip);
    if (!h) return false;
    if (now > h.until) { this.hits.delete(ip); return false; }
    return h.count >= this.max;
  }

  fail(ip: string, now = Date.now()): number {
    const h = this.hits.get(ip);
    if (!h || now > h.until) {
      this.hits.set(ip, { count: 1, until: now + this.windowMs });
      return 1;
    }
    h.count += 1;
    return h.count;
  }

  clear(ip: string): void {
    this.hits.delete(ip);
  }
}

export function hardenHeaders(res: ServerResponse, https: boolean): void {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "same-origin");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("content-security-policy", [
    "default-src 'self'", "img-src 'self' data: blob:", "media-src 'self' blob:", "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:", "script-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'",
    "form-action 'self'", "object-src 'none'",
  ].join("; "));
  if (https) res.setHeader("strict-transport-security", "max-age=31536000");
}
