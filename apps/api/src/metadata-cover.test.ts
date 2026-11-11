import "reflect-metadata";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { compareCovers, fingerprintCover, imageUrl, publicImageAddress, MetadataCoverImages, fetchCoverBytes } from "./metadata-cover-image";
import { MetadataCoverService } from "./metadata-cover.service";

async function sample(invert = false) {
  const data = Buffer.alloc(96 * 64 * 3);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) {
    const i = (y * 96 + x) * 3;
    data[i] = invert ? 255 - x * 2 : x * 2;
    data[i + 1] = invert ? 255 - y * 3 : y * 3;
    data[i + 2] = ((x >> 4) + (y >> 4)) % 2 ? 230 : 20;
  }
  return sharp(data, { raw: { width: 96, height: 64, channels: 3 } }).png().toBuffer();
}
describe("cover image comparison", () => {
  it("compares image bytes, not filenames or IDs; recognizes resizing and JPEG recompression", async () => {
    const original = await sample(), resized = await sharp(original).resize(48, 32).jpeg({ quality: 70 }).toBuffer();
    const a = await fingerprintCover(original), b = await fingerprintCover(resized);
    expect(compareCovers(a, a)).toEqual({ score: 100, exact: true });
    const similar = compareCovers(a, b); expect(similar.exact).toBe(false); expect(similar.score).toBeGreaterThanOrEqual(85);
    expect(compareCovers(a, await fingerprintCover(await sample(true))).score).toBeLessThan(85);
    expect(a.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
  });
  it("rejects invalid, oversized and SVG inputs", async () => {
    await expect(fingerprintCover(Buffer.from("not an image"))).rejects.toThrow();
    await expect(fingerprintCover(Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toThrow();
    await expect(fingerprintCover(Buffer.from('<svg width="16" height="16"><rect width="16" height="16"/></svg>'))).rejects.toThrow();
  });
  it.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.31.0.1", "192.168.1.1", "100.100.100.200", "0.0.0.0", "224.1.1.1", "::1", "::ffff:127.0.0.1", "198.18.1.1"])("blocks non-public image address %s", address => expect(publicImageAddress(address)).toBe(false));
  it("accepts public IPv4 only and refuses non-web URLs, credentials, alternate ports, numeric loopback", async () => {
    expect(publicImageAddress("1.1.1.1")).toBe(true);
    for (const url of ["file:///image.png", "ftp://example.test/image.png", "https://user:secret@example.test/a", "http://example.test:3000/a"]) expect(() => imageUrl(url)).toThrow();
    await expect(fetchCoverBytes("http://2130706433/image.jpg")).rejects.toThrow(/ไม่อนุญาต/);
  });
  it("does not cache repeated failure unboundedly or leak credential-bearing errors", async () => {
    const service = new MetadataCoverImages();
    const url = vi.fn(async () => { throw new Error("SECRET_URL"); });
    await expect(service.load("a", url)).rejects.toThrow("อ่านหรือถอดรหัสรูปไม่สำเร็จ");
    await expect(service.load("a", url)).rejects.toThrow("อ่านหรือถอดรหัสรูปไม่สำเร็จ");
    expect(url).toHaveBeenCalledTimes(1);
  });
});

describe("cover scan service", () => {
  it("finds an unrelated ID by identical cover, reports failures/missing covers, and paginates without writes", async () => {
    const image = await fingerprintCover(await sample());
    const rows = [{ id: "row", status: "PENDING", normalizedJson: { imageUrl: "https://wp.example.test/cover.jpg" } }];
    const videos = Array.from({ length: 17 }, (_, i) => ({ id: String(i).padStart(3, "0"), publicId: `different-${i}`, title: "Recovered", posterKey: i === 1 ? null : `poster-${i}`, updatedAt: new Date(0) }));
    const prisma = { metadataImportBatch: { findUnique: vi.fn(async () => ({ id: "batch" })) }, metadataImportRow: { findMany: vi.fn(async () => rows) }, video: { findFirst: vi.fn(async () => ({ id: "999" })), count: vi.fn(async () => 17), findMany: vi.fn(async (q: any) => videos.filter(v => v.id > q.where.id.gt)) } };
    const storage = { createReadUrl: vi.fn(async (key: string) => `https://storage.example.test/${key}`) };
    const images = { load: vi.fn(async (key: string) => { if (key.startsWith("poster:poster-2:")) throw new Error("อ่านรูปไม่ได้: HTTP 403"); return image; }) };
    const service = new MetadataCoverService(prisma as never, storage as never, images as never);
    const first = await service.scan("batch", { page: 1 });
    expect(first.scanned).toBe(16); expect(first.compared).toBe(14); expect(first.missing).toBe(1); expect(first.failed).toEqual([{ videoId: "002", reason: "อ่านรูปไม่ได้: HTTP 403" }]);
    expect(first.rows[0]!.candidates[0]!.cover).toMatchObject({ exact: true, score: 100 });
    const next = await service.scan("batch", { page: 1, after: first.next!, ceiling: first.ceiling });
    expect(next.scanned).toBe(1); expect(next.next).toBeNull();
    expect(new Set([...first.rows[0]!.candidates, ...next.rows[0]!.candidates].map(v => v.id)).size).toBe(15);
    rows[0]!.normalizedJson = {} as never;
    const noSource = await service.scan("batch", { page: 1 });
    expect(noSource.scanned).toBe(0); expect(noSource.rows[0]!.error).toContain("ไม่มี URL");
    await expect(service.scan("batch", { page: 1, url: "http://internal" })).rejects.toThrow();
  });
});
