import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import sharp from "sharp";

const MAX_BYTES = 5 * 1024 * 1024;
const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blocked.addSubnet(address, prefix);
export const publicImageAddress = (address: string) => isIP(address) === 4 && !blocked.check(address);
export function imageUrl(value: string) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || value.length > 4096) throw new Error("URL รูปไม่รองรับ (ใช้ HTTP/HTTPS พอร์ตมาตรฐาน ไม่มี credentials)");
  return url;
}

// Pin the validated public IPv4 address at connect time, including every redirect.
// No cookies, authorization headers, environment proxy, or imported iframe fetches.
export async function fetchCoverBytes(value: string, redirects = 0, deadline = Date.now() + 4000): Promise<Buffer> {
  const url = imageUrl(value);
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true, family: 4 }).catch(() => { throw new Error("หา IP ของรูปไม่สำเร็จ"); }),
    new Promise<never>((_, reject) => { dnsTimer = setTimeout(() => reject(new Error("อ่านรูปเกินเวลา")), Math.max(1, deadline - Date.now())); })
  ]).finally(() => clearTimeout(dnsTimer));
  if (Date.now() >= deadline) throw new Error("อ่านรูปเกินเวลา");
  if (!addresses.length || addresses.some(a => !publicImageAddress(a.address))) throw new Error("ไม่อนุญาต URL รูปที่ชี้ไปเครือข่ายภายในหรือ IP สงวน");
  const address = addresses[0]!.address;
  const result = await new Promise<Buffer | URL>((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      agent: false, family: 4, headers: { Accept: "image/jpeg,image/png,image/webp", "User-Agent": "3x-storage-cover-review/1" },
      lookup: (_host, _options, callback) => callback(null, address, 4)
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
        res.destroy();
        try { resolve(new URL(res.headers.location, url)); } catch { reject(new Error("URL รูป redirect ไม่ถูกต้อง")); }
        return;
      }
      if (res.statusCode !== 200) { res.destroy(); reject(new Error(`อ่านรูปไม่ได้: HTTP ${res.statusCode}`)); return; }
      if (!/^image\/(jpeg|png|webp)(;|$)/i.test(res.headers["content-type"] || "")) { res.destroy(); reject(new Error("รองรับรูป JPEG/PNG/WebP เท่านั้น")); return; }
      if (Number(res.headers["content-length"]) > MAX_BYTES) { res.destroy(); reject(new Error("รูปใหญ่เกิน 5 MiB")); return; }
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_BYTES) { res.destroy(); reject(new Error("รูปใหญ่เกิน 5 MiB")); } else chunks.push(chunk); });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", () => reject(new Error("อ่านรูปไม่ครบ")));
      res.on("aborted", () => reject(new Error("อ่านรูปไม่ครบ")));
    });
    const timer = setTimeout(() => req.destroy(new Error("อ่านรูปเกินเวลา")), Math.max(1, deadline - Date.now()));
    req.on("close", () => clearTimeout(timer));
    req.on("error", () => reject(new Error("อ่านรูปไม่สำเร็จหรือเกินเวลา")));
    req.end();
  });
  if (result instanceof URL) {
    if (redirects >= 3) throw new Error("รูป redirect เกิน 3 ครั้ง");
    return fetchCoverBytes(result.href, redirects + 1, deadline);
  }
  return result;
}

export type CoverFingerprint = { sha256: string; pixels: Buffer; edges: Buffer; thumbnail: string; width: number; height: number };
export async function fingerprintCover(bytes: Buffer): Promise<CoverFingerprint> {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("รูปว่างหรือใหญ่เกิน 5 MiB");
  const base = sharp(bytes, { limitInputPixels: 20_000_000, failOn: "error" }).rotate();
  const meta = await base.metadata();
  if (!["jpeg", "png", "webp"].includes(meta.format || "") || (meta.pages || 1) > 1) throw new Error("รองรับภาพนิ่ง JPEG/PNG/WebP เท่านั้น");
  const pixels = await base.clone().resize(16, 16, { fit: "fill" }).flatten({ background: "white" }).toColourspace("srgb").removeAlpha().raw().toBuffer();
  const gray = await base.clone().resize(17, 16, { fit: "fill" }).flatten({ background: "white" }).greyscale().raw().toBuffer();
  const edges = Buffer.alloc(256);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) edges[y * 16 + x] = gray[y * 17 + x]! > gray[y * 17 + x + 1]! ? 1 : 0;
  const thumbnail = await base.clone().resize(240, 180, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 60 }).toBuffer();
  return { sha256: createHash("sha256").update(bytes).digest("hex"), pixels, edges, thumbnail: `data:image/jpeg;base64,${thumbnail.toString("base64")}`, width: meta.width!, height: meta.height! };
}
export function compareCovers(a: CoverFingerprint, b: CoverFingerprint) {
  if (a.sha256 === b.sha256) return { score: 100, exact: true };
  let delta = 0, differences = 0;
  for (let i = 0; i < a.pixels.length; i++) delta += (a.pixels[i]! - b.pixels[i]!) ** 2;
  for (let i = 0; i < a.edges.length; i++) differences += a.edges[i] === b.edges[i] ? 0 : 1;
  const color = Math.max(0, 1 - Math.sqrt(delta / a.pixels.length) / 128);
  const structure = 1 - differences / a.edges.length;
  return { score: Math.min(99.9, Math.round((0.65 * color + 0.35 * structure) * 1000) / 10), exact: false };
}

@Injectable()
export class MetadataCoverImages {
  private cache = new Map<string, { image: CoverFingerprint; until: number; bytes: number }>();
  private pending = new Map<string, Promise<CoverFingerprint>>();
  private failures = new Map<string, { until: number; message: string }>();
  private size = 0;
  async load(key: string, getUrl: () => Promise<string>): Promise<CoverFingerprint> {
    const failure = this.failures.get(key);
    if (failure && failure.until > Date.now()) throw new Error(failure.message);
    this.failures.delete(key);
    const old = this.cache.get(key);
    if (old && old.until > Date.now()) { this.cache.delete(key); this.cache.set(key, old); return old.image; }
    if (old) { this.cache.delete(key); this.size -= old.bytes; }
    const pending = this.pending.get(key); if (pending) return pending.catch(() => { throw new Error("อ่านหรือถอดรหัสรูปไม่สำเร็จ"); });
    const work = (async () => {
      const image = await fingerprintCover(await fetchCoverBytes(await getUrl()));
      const bytes = image.thumbnail.length * 2 + image.pixels.length + image.edges.length + 512;
      this.cache.set(key, { image, until: Date.now() + 10 * 60_000, bytes }); this.size += bytes;
      while (this.size > 64 * 1024 * 1024 || this.cache.size > 8192) { const first = this.cache.keys().next().value!; this.size -= this.cache.get(first)!.bytes; this.cache.delete(first); }
      return image;
    })();
    this.pending.set(key, work);
    try { return await work; } catch (e) {
      const message = e instanceof Error && /^(URL รูป|ไม่อนุญาต|อ่านรูป|รูป|รองรับ|หา IP)/.test(e.message) ? e.message : "อ่านหรือถอดรหัสรูปไม่สำเร็จ";
      this.failures.set(key, { until: Date.now() + 60_000, message });
      if (this.failures.size > 1024) this.failures.delete(this.failures.keys().next().value!);
      throw new Error(message);
    } finally { this.pending.delete(key); }
  }
}
