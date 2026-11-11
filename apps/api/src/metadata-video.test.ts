import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { MetadataVideoFrames, detailedImage, sampleTimes, sourcePanels } from "./metadata-video-frames";
import { MetadataVideoController, MetadataVideoService } from "./metadata-video.service";
import { fingerprintCover, compareCovers } from "./metadata-cover-image";
import * as images from "./metadata-cover-image";
import { Readable } from "node:stream";

async function picture(invert = false) {
  const pixels = Buffer.alloc(64 * 96 * 3);
  for (let y = 0; y < 96; y++) for (let x = 0; x < 64; x++) {
    const i = (y * 64 + x) * 3;
    pixels[i] = invert ? 255 - x * 4 : x * 4; pixels[i + 1] = invert ? 255 - y * 2 : y * 2;
    pixels[i + 2] = ((x >> 3) + (y >> 3)) % 2 ? 220 : 10;
  }
  return sharp(pixels, { raw: { width: 64, height: 96, channels: 3 } }).png().toBuffer();
}
afterEach(() => vi.restoreAllMocks());
describe("video frame discovery", () => {
  it("compares individual panels of a recompressed three-frame collage, not a person's identity", async () => {
    const a = await picture(), b = await picture(true);
    const collage = await sharp({ create: { width: 192, height: 96, channels: 3, background: "white" } }).composite([{ input: b, left: 0, top: 0 }, { input: a, left: 64, top: 0 }, { input: b, left: 128, top: 0 }]).webp({ quality: 80 }).toBuffer();
    const panels = await sourcePanels(collage), frame = await fingerprintCover(a);
    const ranked = panels.map(p => ({ label: p.label, score: compareCovers(p.image, frame).score })).sort((a, b) => b.score - a.score);
    expect(panels).toHaveLength(6); expect(ranked[0]!.label).toBe("ช่อง 2/3 จากซ้าย"); expect(ranked[0]!.score).toBeGreaterThan(85);
    expect(compareCovers(frame, await fingerprintCover(b)).score).toBeLessThan(70);
  });
  it("samples the complete timeline deterministically and rejects invalid duration/count", () => {
    expect(sampleTimes(120, 30)).toHaveLength(30); expect(sampleTimes(120, 30)[0]).toBe(0); expect(sampleTimes(120, 30).at(-1)).toBe(119.9);
    for (const d of [0, -1, NaN, Infinity, 86401]) expect(() => sampleTimes(d, 30)).toThrow();
    expect(() => sampleTimes(30, 1)).toThrow();
  });
  it("excludes solid/fade frames that could falsely match unrelated videos", async () => {
    const blank = await fingerprintCover(await sharp({ create: { width: 64, height: 64, channels: 3, background: "black" } }).png().toBuffer());
    expect(detailedImage(blank)).toBe(false); expect(detailedImage(await fingerprintCover(await picture()))).toBe(true);
  });

  async function fixture() {
    const bytes = await picture(), image = await fingerprintCover(bytes);
    vi.spyOn(images, "fetchCoverBytes").mockResolvedValue(bytes);
    const videos = [{ id: "v1", publicId: "p1", title: "Generic sample", originalKey: "media/original.mp4", updatedAt: new Date(0), files: [] }];
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: `row-${i}`, normalizedJson: { imageUrl: "https://example.test/cover.jpg" } }));
    const prisma = { metadataImportBatch: { findUnique: vi.fn(async () => ({ id: "batch" })) }, metadataImportRow: { findMany: vi.fn(async () => rows) }, video: {
      count: vi.fn(async () => videos.length), findFirst: vi.fn(async (q: any) => q.where.updatedAt ? videos.find(v => v.id === q.where.id) : q.orderBy.id === "desc" ? videos.at(-1) : videos.find(v => v.id > q.where.id.gt))
    } };
    const frames = { duration: vi.fn(async () => 60), frame: vi.fn(async () => image) };
    return { service: new MetadataVideoService(prisma as never, frames as never), frames, prisma };
  }
  it("scans every batch row across display pages, emits timestamped candidates and makes no metadata writes", async () => {
    const { service, frames, prisma } = await fixture();
    let result = await service.step("batch", { samples: 12, threshold: 80 }, "admin");
    const id = result.scanId;
    for (let i = 1; i < 30; i++) result = await service.step("batch", { scanId: id }, "admin");
    expect(result.loaded).toBe(30);
    await service.step("batch", { scanId: id }, "admin"); // probe
    result = await service.step("batch", { scanId: id }, "admin");
    expect(result.matches).toHaveLength(30); expect(result.matches.some(m => m.rowId === "row-29")).toBe(true);
    expect(result.frame?.seconds).toBe(0); expect(result).not.toHaveProperty("autoRows");
    while (!result.done) result = await service.step("batch", { scanId: id }, "admin");
    expect(result.frames).toBe(12); expect(result.scanned).toBe(1); expect(frames.frame).toHaveBeenCalledTimes(12);
    expect(prisma.video.findFirst.mock.calls.every(([q]) => q.where.posterKey === null)).toBe(true);
  });
  it("binds sessions to actor/batch, rejects URL/target injection and cancels without writing", async () => {
    const { service } = await fixture();
    const first = await service.step("batch", {}, "admin");
    await expect(service.step("batch", { scanId: first.scanId }, "other")).rejects.toThrow();
    await expect(service.step("other", { scanId: first.scanId }, "admin")).rejects.toThrow();
    await expect(service.step("batch", { url: "http://127.0.0.1/private", targetVideoId: "v1" }, "admin")).rejects.toThrow();
    expect(() => service.cancel("batch", first.scanId, "other")).toThrow();
    service.cancel("batch", first.scanId, "admin");
    await expect(service.step("batch", { scanId: first.scanId }, "admin")).rejects.toThrow();
  });
  it("reports a frame failure as incomplete, advances and never claims a negative match", async () => {
    const { service, frames } = await fixture();
    let result = await service.step("batch", {}, "admin");
    for (let i = 1; i < 31; i++) result = await service.step("batch", { scanId: result.scanId }, "admin");
    frames.frame.mockRejectedValueOnce(new Error("read budget exceeded"));
    result = await service.step("batch", { scanId: result.scanId }, "admin");
    expect(result.failure?.reason).toBe("read budget exceeded"); expect(result.failed).toBe(1); expect(result.matches).toEqual([]);
    result = await service.step("batch", { scanId: result.scanId }, "admin"); expect(result.done).toBe(true);
  });
  it("guards frame endpoints with session, administrator and CSRF checks, and no-store", () => {
    expect(Reflect.getMetadata("__guards__", MetadataVideoController).map((g: { name: string }) => g.name)).toEqual(["AdminSessionGuard", "MetadataAdminGuard", "CsrfGuard"]);
    expect(Reflect.getMetadata("__headers__", MetadataVideoController.prototype.step)).toContainEqual({ name: "Cache-Control", value: "private, no-store, max-age=0" });
  });
  it("relays only the selected object and a bounded range; rejects other paths and methods", async () => {
    const readRange = vi.fn(async () => ({ ContentRange: "bytes 2-4/6", ContentLength: 3, Body: Readable.from([Buffer.from("cde")]) }));
    const reader = new MetadataVideoFrames({ readRange } as never);
    await (reader as any).read("db-selected-key", async (url: string) => {
      expect((await fetch(url + "/other")).status).toBe(403);
      expect((await fetch(url, { method: "POST" })).status).toBe(403);
      expect((await fetch(url, { headers: { Range: "bytes=0-2,4-5" } })).status).toBe(416);
      const result = await fetch(url, { headers: { Range: "bytes=2-4" } });
      expect(result.status).toBe(206); expect(await result.text()).toBe("cde");
    }, '"object-version"');
    expect(readRange).toHaveBeenCalledTimes(1);
    expect(readRange).toHaveBeenCalledWith("db-selected-key", "bytes=2-4", expect.any(AbortSignal), '"object-version"');
  });
  it("cuts off a storage stream that exceeds the per-frame read budget", async () => {
    const reader = new MetadataVideoFrames({ readRange: vi.fn(async () => ({ ContentRange: "bytes 0-68157439/68157440", ContentLength: 68157440, Body: Readable.from([Buffer.alloc(65 * 1024 * 1024)]) })) } as never);
    await (reader as any).read("db-selected-key", async (url: string, signal: AbortSignal) => {
      await expect(fetch(url).then(r => r.arrayBuffer())).rejects.toThrow();
      expect(signal.aborted).toBe(true);
    });
  });
});
