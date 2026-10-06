/**
 * Video for the owner's own screen: what the browser plays is streamed as is (HTTP ranges);
 * the rest is prepared once into a cached MP4 — remuxed when only the container is the problem,
 * transcoded to H.264/AAC otherwise (NVENC when the GPU has it). Plus single frames for tools,
 * and subtitles as WebVTT. Clips are never cut for anyone (SOUL.md).
 */
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** One audio or subtitle stream: `n` counts within its kind (0:a:n, 0:s:n). */
export interface Track {
  n: number;
  codec: string;
  lang: string | null;
  title: string | null;
  default: boolean;
  channels?: number;
  forced?: boolean;
  /** Subtitles only: text the browser can show (SRT, ASS, WebVTT, mov_text), not pictures (PGS, VobSub). */
  text?: boolean;
}

export interface Probe {
  container: string;
  video: string | null;
  /** The first audio stream's codec. */
  audio: string | null;
  duration: number;
  /** PQ or HLG (a UHD Blu-ray transfer): frames and conversions are tone-mapped to SDR. */
  hdr?: boolean;
  audios?: Track[];
  subs?: Track[];
}

const TEXT_SUBS = new Set(["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"]);

const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);
/** HDR to SDR BT.709. Read as is, an HDR picture comes out grey and washed out; mobius keeps the brightness. */
export const TONEMAP = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:desat=0,"
  + "zscale=t=bt709:m=bt709:r=tv,format=yuv420p";

const DIRECT_EXT = new Set([".mp4", ".m4v", ".mov", ".webm"]);
const DIRECT_VIDEO = new Set(["h264", "vp8", "vp9", "av1"]);
const DIRECT_AUDIO = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);
const COPY_AUDIO = new Set(["aac", "mp3"]);

const probes = new Map<string, { mtime: number; probe: Probe }>();

export async function probe(file: string): Promise<Probe> {
  const mtime = statSync(file).mtimeMs;
  const hit = probes.get(file);
  if (hit && hit.mtime === mtime) return hit.probe;
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries",
    "stream=codec_type,codec_name,color_transfer,channels:stream_tags=language,title:stream_disposition=default,forced"
    + ":format=format_name,duration", "-of", "json", file]);
  type Stream = { codec_type: string; codec_name: string; color_transfer?: string; channels?: number;
    tags?: { language?: string; title?: string }; disposition?: { default?: number; forced?: number } };
  const data = JSON.parse(stdout) as { streams?: Stream[]; format?: { format_name?: string; duration?: string } };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const track = (s: Stream, n: number): Track => ({
    n, codec: s.codec_name ?? "", lang: s.tags?.language && s.tags.language !== "und" ? s.tags.language.toLowerCase() : null,
    title: s.tags?.title?.trim() || null, default: s.disposition?.default === 1,
    ...(s.channels ? { channels: s.channels } : {}), ...(s.disposition?.forced === 1 ? { forced: true } : {}),
  });
  const audios = streams.filter((s) => s.codec_type === "audio").map(track);
  const subs = streams.filter((s) => s.codec_type === "subtitle").map((s, n) => ({ ...track(s, n), text: TEXT_SUBS.has(s.codec_name) }));
  const p: Probe = {
    container: data.format?.format_name ?? "",
    video: video?.codec_name ?? null,
    hdr: HDR_TRANSFERS.has(video?.color_transfer ?? ""),
    audio: audios[0]?.codec ?? null,
    duration: Number(data.format?.duration ?? 0),
    audios, subs,
  };
  probes.set(file, { mtime, probe: p });
  return p;
}

/** A valid audio stream number for this file: `asked` if it exists, else 0. */
export function audioOf(p: Probe, asked: number | null | undefined): number {
  const n = Number(asked ?? 0);
  return Number.isInteger(n) && n > 0 && n < (p.audios?.length ?? 0) ? n : 0;
}

/** As is, in the browser: a container and codecs it plays, with the first audio track (it plays that one). */
export function playsDirectly(file: string, p: Probe, audio = 0): boolean {
  return audio === 0 && DIRECT_EXT.has(extname(file).toLowerCase()) && p.video !== null && DIRECT_VIDEO.has(p.video)
    && (p.audio === null || DIRECT_AUDIO.has(p.audio));
}

/** The ffmpeg arguments that turn the file into a browser-friendly MP4, with audio track `audio`. */
export function prepareArgs(file: string, p: Probe, out: string, nvenc: boolean, audio = 0): string[] {
  const args = ["-hide_banner", "-nostdin", "-y", "-i", file, "-map", "0:v:0", "-map", `0:a:${audio}?`, "-sn"];
  if (p.hdr) args.push("-vf", TONEMAP);
  if (p.video === "h264" && !p.hdr) args.push("-c:v", "copy");
  else if (nvenc) args.push("-c:v", "h264_nvenc", "-preset", "p5", "-cq", "23", "-pix_fmt", "yuv420p");
  else args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p");
  const codec = p.audios?.[audio]?.codec ?? p.audio;
  if (codec && COPY_AUDIO.has(codec)) args.push("-c:a", "copy");
  else args.push("-c:a", "aac", "-b:a", "192k", "-ac", "2");
  args.push("-movflags", "+faststart", "-progress", "pipe:1", "-f", "mp4", out);
  return args;
}

let nvencAvailable: boolean | null = null;
async function hasNvenc(): Promise<boolean> {
  if (nvencAvailable === null) {
    try {
      // Listed is not enough: a machine without the driver lists it and fails. Encode 1 frame.
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=size=256x256:duration=0.1",
        "-frames:v", "1", "-c:v", "h264_nvenc", "-f", "null", "-"], { timeout: 20_000 });
      nvencAvailable = true;
    } catch {
      nvencAvailable = false;
    }
  }
  return nvencAvailable;
}

export interface Job {
  state: "queued" | "running" | "done" | "failed";
  progress: number;
  error?: string;
}

const jobs = new Map<string, Job>();
const queue: (() => Promise<void>)[] = [];
let busy = false;

function pump(): void {
  if (busy) return;
  const next = queue.shift();
  if (!next) return;
  busy = true;
  next().finally(() => { busy = false; pump(); });
}

/** The prepared copy's place; the first audio track keeps the name copies had before tracks existed. */
export function cachedPath(file: string, cacheDir: string, audio = 0): string {
  const key = createHash("sha1").update(`${file}:${statSync(file).mtimeMs}${audio ? `:a${audio}` : ""}`).digest("hex").slice(0, 20);
  return join(cacheDir, "video", `${key}.mp4`);
}

/** Where the browser should read this file from (with audio track `audio`): itself, a ready cache, or a job. */
export async function playable(file: string, cacheDir: string, audio = 0): Promise<{ path: string } | { job: Job }> {
  const p = await probe(file);
  const a = audioOf(p, audio);
  if (playsDirectly(file, p, a)) return { path: file };
  const out = cachedPath(file, cacheDir, a);
  if (existsSync(out)) return { path: out };
  return { job: jobs.get(out) ?? { state: "queued", progress: 0 } };
}

/** Queue the preparation (once per file and audio track); one ffmpeg at a time. */
export async function prepare(file: string, cacheDir: string, audio = 0): Promise<Job> {
  const a = audioOf(await probe(file), audio);
  const out = cachedPath(file, cacheDir, a);
  if (existsSync(out)) return { state: "done", progress: 1 };
  const existing = jobs.get(out);
  if (existing && existing.state !== "failed") return existing;
  const job: Job = { state: "queued", progress: 0 };
  jobs.set(out, job);
  queue.push(async () => {
    job.state = "running";
    const p = await probe(file);
    mkdirSync(join(cacheDir, "video"), { recursive: true });
    const tmp = `${out}.part.mp4`;
    const args = prepareArgs(file, p, tmp, (p.video !== "h264" || !!p.hdr) && await hasNvenc(), a);
    await new Promise<void>((resolve) => {
      const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
      let err = "";
      ff.stdout.on("data", (chunk: Buffer) => {
        const m = /out_time_us=(\d+)/.exec(chunk.toString());
        if (m && p.duration > 0) job.progress = Math.min(0.99, Number(m[1]) / 1e6 / p.duration);
      });
      ff.stderr.on("data", (chunk: Buffer) => { err = (err + chunk.toString()).slice(-2000); });
      ff.on("close", (code) => {
        if (code === 0) {
          renameSync(tmp, out);
          job.state = "done";
          job.progress = 1;
        } else {
          rmSync(tmp, { force: true });
          job.state = "failed";
          job.error = err.split("\n").filter(Boolean).slice(-3).join(" ");
        }
        resolve();
      });
    });
  });
  pump();
  return job;
}

const extracting = new Map<string, Promise<void>>();

/** One frame at `seconds`, as JPEG, cached. Asking twice at once runs ffmpeg once. */
export async function frame(file: string, seconds: number, cacheDir: string): Promise<Buffer> {
  const t = Math.max(0, Math.round(seconds * 10) / 10);
  const hdr = (await probe(file)).hdr === true;
  const key = createHash("sha1").update(`${file}:${statSync(file).mtimeMs}:${t}${hdr ? ":sdr" : ""}`).digest("hex").slice(0, 20);
  const out = join(cacheDir, "frames", `${key}.jpg`);
  if (!existsSync(out)) {
    let job = extracting.get(out);
    if (!job) {
      job = (async () => {
        mkdirSync(join(cacheDir, "frames"), { recursive: true });
        const tmp = `${out}.${process.pid}.${randomBytes(4).toString("hex")}.jpg`;
        await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-ss", String(t), "-i", file,
          "-frames:v", "1", "-q:v", "3", "-vf", `${hdr ? `${TONEMAP},` : ""}scale='min(1920,iw)':-2`, tmp], { timeout: 60_000 });
        renameSync(tmp, out);
      })().finally(() => extracting.delete(out));
      extracting.set(out, job);
    }
    await job;
  }
  return readFileSync(out);
}

/** SRT → WebVTT: a header, and commas to dots in the timings. */
export function srtToVtt(srt: string): string {
  const body = srt.replace(/^﻿/, "").replace(/\r\n?/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return `WEBVTT\n\n${body.trim()}\n`;
}

/**
 * A text subtitle stream inside the video (0:s:n) as WebVTT, cached: getting it out reads the
 * whole file, which for a film takes a while. Picture subtitles (PGS, VobSub) can't become text.
 */
export async function embeddedVtt(file: string, n: number, cacheDir: string): Promise<string> {
  const sub = (await probe(file)).subs?.[n];
  if (!sub) throw new RangeError(`no subtitle stream ${n}`);
  if (!sub.text) throw new Error(`subtitle stream ${n} is pictures (${sub.codec}), not text`);
  const key = createHash("sha1").update(`${file}:${statSync(file).mtimeMs}:s${n}`).digest("hex").slice(0, 20);
  const out = join(cacheDir, "subs", `${key}.vtt`);
  if (!existsSync(out)) {
    let job = extracting.get(out);
    if (!job) {
      job = (async () => {
        mkdirSync(join(cacheDir, "subs"), { recursive: true });
        const tmp = `${out}.${process.pid}.${randomBytes(4).toString("hex")}`;
        await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", file, "-map", `0:s:${n}`, "-f", "webvtt", tmp],
          { timeout: 10 * 60_000 });
        renameSync(tmp, out);
      })().finally(() => extracting.delete(out));
      extracting.set(out, job);
    }
    await job;
  }
  return readFileSync(out, "utf8");
}

export async function subtitlesVtt(file: string): Promise<string> {
  const ext = extname(file).toLowerCase();
  if (ext === ".vtt") return readFileSync(file, "utf8");
  if (ext === ".srt") return srtToVtt(readFileSync(file, "utf8"));
  const { stdout } = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-f", "webvtt", "-"],
    { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}
