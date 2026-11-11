import { Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import type { Readable } from "node:stream";
import sharp from "sharp";
import { StorageService } from "./storage.service";
import { fingerprintCover, type CoverFingerprint } from "./metadata-cover-image";

export type SourcePanel = { label: string; image: CoverFingerprint };
export function detailedImage(image: CoverFingerprint) {
  // Ignore blank/fade frames: equal solid colours otherwise score misleadingly high.
  let variance = 0;
  for (let channel = 0; channel < 3; channel++) {
    let sum = 0, squares = 0;
    for (let i = channel; i < image.pixels.length; i += 3) { sum += image.pixels[i]!; squares += image.pixels[i]! ** 2; }
    const count = image.pixels.length / 3;
    variance += squares / count - (sum / count) ** 2;
  }
  return variance / 3 >= 100;
}
export async function sourcePanels(bytes: Buffer): Promise<SourcePanel[]> {
  // Validate before cropping; this rejects SVG, animated and oversized images.
  const full = await fingerprintCover(bytes);
  const panels: SourcePanel[] = [{ label: "ภาพเต็ม", image: full }];
  const normalized = await sharp(bytes).rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const { width = 0, height = 0 } = await sharp(normalized).metadata();
  // Compare each equal-width panel independently, including the three-frame collage case.
  if (width >= height * 1.2) for (const count of [2, 3]) {
    for (let i = 0; i < count; i++) {
      const left = Math.floor(width * i / count), right = Math.floor(width * (i + 1) / count);
      const crop = await sharp(normalized).extract({ left, top: 0, width: right - left, height }).png().toBuffer();
      panels.push({ label: `ช่อง ${i + 1}/${count} จากซ้าย`, image: await fingerprintCover(crop) });
    }
  }
  return panels;
}

export function sampleTimes(duration: number, count: number) {
  if (!Number.isInteger(count) || count < 2 || count > 60) throw new Error("จำนวนเฟรมไม่ถูกต้อง");
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new Error("ระยะเวลาวิดีโอไม่ถูกต้องหรือเกิน 24 ชั่วโมง");
  return Array.from({ length: count }, (_, i) => Number(((duration - Math.min(0.1, duration / 10)) * i / (count - 1)).toFixed(3)));
}

const MAX_BYTES = 64 * 1024 * 1024;
const INPUT_OPTIONS = ["-v", "error", "-max_alloc", "67108864", "-protocol_whitelist", "http,tcp,pipe", "-format_whitelist", "mov,matroska,webm,avi,flv,mpeg,mpegts", "-rw_timeout", "5000000", "-probesize", "2097152", "-analyzeduration", "3000000"];

export function runMediaTool(command: string, args: string[], signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
      // No database/storage credentials or outbound proxy settings in the decoder.
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, LANG: "C.UTF-8" }
    });
    let length = 0, failed = false;
    const chunks: Buffer[] = [];
    const abort = () => { failed = true; child.kill("SIGKILL"); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > 2 * 1024 * 1024) abort(); else chunks.push(chunk);
    });
    child.on("error", () => { signal.removeEventListener("abort", abort); reject(new Error("เรียก FFmpeg/FFprobe ไม่ได้ กรุณาติดตั้ง runtime เวอร์ชันใหม่")); });
    child.on("close", code => {
      signal.removeEventListener("abort", abort);
      if (failed || code !== 0 || !length) reject(new Error("อ่านเฟรมไม่สำเร็จ: ไฟล์ไม่รองรับ อ่านไม่ได้ หรือเกินเวลา/ขนาดที่จำกัด"));
      else resolve(Buffer.concat(chunks));
    });
  });
}

@Injectable()
export class MetadataVideoFrames {
  constructor(private readonly storage: StorageService) {}

  private async read<T>(key: string, work: (url: string, signal: AbortSignal) => Promise<T>): Promise<T> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 20_000);
    let used = 0, requests = 0;
    const token = `/${randomUUID()}`;
    // The child gets a local, short-lived, single-object range relay, never credentials
    // or an imported URL. No video is written to disk or to object storage.
    const server = createServer(async (req, res) => {
      if (req.url !== token || req.method !== "GET" || ++requests > 64 || abort.signal.aborted) { res.writeHead(403).end(); return; }
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "bytes=0-");
      if (!match) { res.writeHead(416).end(); return; }
      const start = Number(match[1]), available = MAX_BYTES - used;
      const end = Math.min(match[2] ? Number(match[2]) : start + available - 1, start + available - 1);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || available <= 0) { abort.abort(); res.writeHead(416).end(); return; }
      const requestAbort = new AbortController();
      const cancel = () => requestAbort.abort();
      abort.signal.addEventListener("abort", cancel, { once: true });
      res.on("close", cancel);
      let stream: Readable | undefined;
      try {
        const object = await this.storage.readRange(key, `bytes=${start}-${end}`, requestAbort.signal);
        if (!object.ContentRange || !object.Body) throw new Error("Range response required");
        res.writeHead(206, { "Content-Range": object.ContentRange, "Content-Length": String(object.ContentLength), "Accept-Ranges": "bytes", "Content-Type": "application/octet-stream" });
        stream = object.Body as Readable;
        for await (const chunk of stream) {
          used += chunk.length;
          if (used > MAX_BYTES || abort.signal.aborted) { abort.abort(); throw new Error("Budget exceeded"); }
          if (!res.write(chunk)) await once(res, "drain", { signal: requestAbort.signal });
        }
        res.end();
      } catch { res.destroy(); }
      finally { stream?.destroy(); abort.signal.removeEventListener("abort", cancel); }
    });
    try {
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Frame reader unavailable");
      return await work(`http://127.0.0.1:${address.port}${token}`, abort.signal);
    } finally { clearTimeout(timeout); abort.abort(); server.closeAllConnections(); server.close(); }
  }

  async duration(key: string) {
    return this.read(key, async (url, signal) => {
      const bytes = await runMediaTool(process.env.FFPROBE_PATH || "ffprobe", [...INPUT_OPTIONS, "-show_entries", "format=duration", "-of", "json", url], signal);
      const duration = Number(JSON.parse(bytes.toString()).format?.duration);
      sampleTimes(duration, 2);
      return duration;
    });
  }

  async frame(key: string, time: number) {
    return this.read(key, async (url, signal) => {
      const bytes = await runMediaTool(process.env.FFMPEG_PATH || "ffmpeg", [...INPUT_OPTIONS, "-threads", "1", "-ss", String(time), "-i", url, "-map", "0:v:0", "-frames:v", "1", "-an", "-sn", "-dn", "-vf", "scale=320:320:force_original_aspect_ratio=decrease", "-threads", "1", "-filter_threads", "1", "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "3", "pipe:1"], signal);
      return fingerprintCover(bytes);
    });
  }
}
