/**
 * Pages and frames scaled down for agents: a 3000-pixel scan costs a model far more than it can
 * read, and 1200 wide keeps the speech balloons legible. ffmpeg (already needed for video) does
 * the work; without it, or on any error, the original goes out unchanged.
 */
import { spawn } from "node:child_process";

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
