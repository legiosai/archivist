/**
 * Pages and frames scaled down for agents: a 3000-pixel scan costs a model far more than it can
 * read, and 1200 wide keeps the speech balloons legible. ffmpeg (already needed for video) does
 * the work; without it, or on any error, the original goes out unchanged.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export async function scaleDown(data: Buffer, type: string, maxWidth: number): Promise<{ type: string; data: Buffer }> {
  if (!maxWidth || maxWidth <= 0) return { type, data };
  const out = await new Promise<Buffer | null>((resolve) => {
    const ff = spawn("ffmpeg", ["-v", "error", "-i", "pipe:0", "-vf", `scale='min(${Math.round(maxWidth)},iw)':-2`,
      "-frames:v", "1", "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "3", "pipe:1"], { stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    ff.stdout.on("data", (c: Buffer) => chunks.push(c));
    ff.on("error", () => resolve(null));
    ff.stdin.on("error", () => {});
    ff.on("close", (code) => resolve(code === 0 && chunks.length ? Buffer.concat(chunks) : null));
    ff.stdin.end(data);
  });
  return out ? { type: "image/jpeg", data: out } : { type, data };
}

/**
 * A smaller copy for grids and lists (`?w=` on covers, pages and frames), made once and kept under
 * the cache folder. `key` names the source and its version (path and mtime); widths snap to a few
 * sizes so a client can't fill the disk with one copy per pixel.
 */
export const THUMB_WIDTHS = [160, 320, 480, 640, 960];

export function thumbWidth(asked: string | null): number {
  const w = Number(asked);
  if (!asked || !Number.isFinite(w) || w <= 0) return 0;
  return THUMB_WIDTHS.find((s) => s >= w) ?? THUMB_WIDTHS.at(-1)!;
}

export async function thumbnail(cacheDir: string, key: string, width: number,
                                source: () => Promise<{ type: string; data: Buffer }>): Promise<{ type: string; data: Buffer }> {
  const name = createHash("sha1").update(`${key}:${width}`).digest("hex").slice(0, 24);
  const file = join(cacheDir, "thumbs", `${name}.jpg`);
  if (existsSync(file)) return { type: "image/jpeg", data: readFileSync(file) };
  const src = await source();
  const out = await scaleDown(src.data, src.type, width);
  if (out.type === "image/jpeg" && out.data !== src.data) {
    mkdirSync(join(cacheDir, "thumbs"), { recursive: true });
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}`;
    writeFileSync(tmp, out.data);
    renameSync(tmp, file);
  }
  return out;
}
