import { BadRequestException, Body, ConflictException, Controller, Header, HttpException, Injectable, NotFoundException, Param, Post, Req, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AdminSessionGuard, CsrfGuard, type AdminRequest } from "./admin-auth.guard";
import { MetadataAdminGuard } from "./metadata-import.controller";
import { PrismaService } from "./prisma.service";
import { compareCovers, fetchCoverBytes } from "./metadata-cover-image";
import { MetadataVideoFrames, detailedImage, sampleTimes, sourcePanels, type SourcePanel } from "./metadata-video-frames";

const input = z.object({ scanId: z.string().uuid().optional(), threshold: z.number().int().min(70).max(95).default(80), samples: z.union([z.literal(12), z.literal(30), z.literal(60)]).default(30) }).strict();
const eligible = { deletedAt: null, posterKey: null, status: { in: ["UPLOADED", "PROCESSING", "READY"] as ("UPLOADED" | "PROCESSING" | "READY")[] } };
type Scan = {
  actor: string; batch: string; expires: number; busy: boolean; threshold: number; samples: number;
  sources: { id: string; url?: string; panels?: SourcePanel[]; best: Map<string, number> }[];
  loaded: number; total: number; scanned: number; frames: number; failed: number; ceiling: string; after: string;
  current?: { id: string; publicId: string; title: string; key: string; version: string; times: number[]; index: number };
  done: boolean;
};

@Injectable()
export class MetadataVideoService {
  private scans = new Map<string, Scan>();
  private active = false;
  constructor(private readonly prisma: PrismaService, private readonly frames: MetadataVideoFrames) {}

  async step(batchId: string, body: unknown, actor: string) {
    const parsed = input.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ตั้งค่าตรวจวิดีโอไม่ถูกต้อง");
    for (const [id, scan] of this.scans) if (!scan.busy && scan.expires < Date.now()) this.scans.delete(id);
    if (this.active) throw new HttpException("กำลังอ่านเฟรมอื่น กรุณารอ", 429);
    this.active = true;
    let scan: Scan | undefined;
    try {
      const scanId = parsed.data.scanId || randomUUID();
      if (!parsed.data.scanId) {
        if (this.scans.size >= 4) throw new HttpException("มีงานตรวจวิดีโอค้างอยู่ กรุณาหยุดงานเดิมหรือรอหมดอายุ", 429);
        if (!await this.prisma.metadataImportBatch.findUnique({ where: { id: batchId }, select: { id: true } })) throw new NotFoundException("ไม่พบ batch");
        const rows = await this.prisma.metadataImportRow.findMany({ where: { batchId, status: "PENDING" }, orderBy: { ordinal: "asc" }, take: 501, select: { id: true, normalizedJson: true } });
        if (rows.length > 500) throw new BadRequestException("batch ต้องไม่เกิน 500 รายการ");
        const ceiling = (await this.prisma.video.findFirst({ where: eligible, orderBy: { id: "desc" }, select: { id: true } }))?.id || "";
        const total = await this.prisma.video.count({ where: { ...eligible, id: { lte: ceiling } } });
        scan = { actor, batch: batchId, expires: 0, busy: false, threshold: parsed.data.threshold, samples: parsed.data.samples, sources: rows.map(row => ({ id: row.id, url: (row.normalizedJson as { imageUrl?: string }).imageUrl, best: new Map() })), loaded: 0, total, scanned: 0, frames: 0, failed: 0, ceiling, after: "", done: false };
        this.scans.set(scanId, scan);
      } else scan = this.scans.get(scanId);
      if (!scan || scan.actor !== actor || scan.batch !== batchId || scan.done) throw new ConflictException("รอบตรวจหมดอายุ กรุณาเริ่มใหม่");
      scan.busy = true; scan.expires = Date.now() + 60 * 60_000;
      const sources: { rowId: string; source: string | null; error: string | null; candidates: never[] }[] = [];
      const matches: { rowId: string; score: number; panel: string }[] = [];
      let frame: { id: string; publicId: string; title: string; seconds: number; thumbnail: string } | null = null;
      let failure: { videoId: string; reason: string } | null = null;
      // One source or one frame per request. Display pagination never limits this work.
      if (scan.loaded < scan.sources.length) {
        const source = scan.sources[scan.loaded]!;
        try {
          if (!source.url) throw new Error("ไม่มีรูปต้นทางในรายการนี้");
          source.panels = await sourcePanels(await fetchCoverBytes(source.url));
          sources.push({ rowId: source.id, source: source.panels[0]!.image.thumbnail, error: null, candidates: [] });
        } catch { sources.push({ rowId: source.id, source: null, error: "ไม่มีรูปต้นทางหรืออ่านรูปไม่ได้ จึงข้ามรายการนี้", candidates: [] }); }
        scan.loaded++;
      } else if (!scan.sources.some(source => source.panels)) scan.done = true;
      else if (!scan.current) {
        const video = await this.prisma.video.findFirst({ where: { ...eligible, id: { gt: scan.after, lte: scan.ceiling } }, orderBy: { id: "asc" }, select: { id: true, publicId: true, title: true, originalKey: true, updatedAt: true, files: { where: { role: "ORIGINAL" }, orderBy: { createdAt: "desc" }, take: 1, select: { storageKey: true } } } });
        if (!video) scan.done = true;
        else {
          try {
            const key = video.files[0]?.storageKey || video.originalKey;
            if (!key) throw new Error("ไม่มีไฟล์วิดีโอต้นฉบับให้ตรวจ");
            // Probe the actual object; legacy duration metadata can be absent or stale.
            const duration = await this.frames.duration(key);
            scan.current = { id: video.id, publicId: video.publicId, title: video.title, key, version: video.updatedAt.toISOString(), times: sampleTimes(duration, scan.samples), index: 0 };
          } catch (error) {
            failure = { videoId: video.id, reason: error instanceof Error ? error.message : "อ่านวิดีโอไม่ได้" };
            scan.failed++; scan.scanned++; scan.after = video.id;
          }
        }
      } else {
        const video = scan.current;
        try {
          const unchanged = await this.prisma.video.findFirst({ where: { ...eligible, id: video.id, updatedAt: new Date(video.version) }, select: { id: true } });
          if (!unchanged) throw new Error("วิดีโอเปลี่ยนแปลงระหว่างตรวจ กรุณาเริ่มรอบใหม่");
          const seconds = video.times[video.index]!;
          const image = await this.frames.frame(video.key, seconds);
          scan.frames++;
          frame = { id: video.id, publicId: video.publicId, title: video.title, seconds, thumbnail: image.thumbnail };
          for (const source of scan.sources) {
            const best = detailedImage(image) ? source.panels?.filter(panel => detailedImage(panel.image)).map(panel => ({ score: compareCovers(panel.image, image).score, panel: panel.label })).sort((a, b) => b.score - a.score)[0] : undefined;
            if (!best || best.score < scan.threshold || best.score <= (source.best.get(video.id) || 0)) continue;
            const minimum = Math.min(...source.best.values());
            if (!source.best.has(video.id) && source.best.size >= 5 && best.score <= minimum) continue;
            source.best.set(video.id, best.score);
            if (source.best.size > 5) source.best.delete([...source.best].sort((a, b) => a[1] - b[1])[0]![0]);
            matches.push({ rowId: source.id, ...best });
          }
          video.index++;
        } catch (error) {
          failure = { videoId: video.id, reason: error instanceof Error ? error.message : "อ่านเฟรมไม่ได้" };
          scan.failed++; video.index = video.times.length;
        }
        if (video.index >= video.times.length) { scan.scanned++; scan.after = video.id; scan.current = undefined; }
      }
      const result = { scanId, done: scan.done, sources, matches, frame, failure, loaded: scan.loaded, sourceTotal: scan.sources.length, total: scan.total, scanned: scan.scanned, frames: scan.frames, failed: scan.failed, current: scan.current ? { id: scan.current.id, sample: scan.current.index, samples: scan.samples } : null };
      if (scan.done) this.scans.delete(scanId);
      return result;
    } finally { if (scan) scan.busy = false; this.active = false; }
  }

  cancel(batchId: string, scanId: string, actor: string) {
    const scan = this.scans.get(scanId);
    if (scan && (scan.actor !== actor || scan.batch !== batchId)) throw new ConflictException("ไม่ใช่รอบตรวจของผู้ใช้คนนี้");
    this.scans.delete(scanId);
    return { stopped: true };
  }
}

@Controller("metadata-import")
@UseGuards(AdminSessionGuard, MetadataAdminGuard, CsrfGuard)
export class MetadataVideoController {
  constructor(private readonly service: MetadataVideoService) {}
  @Post("batches/:id/video-scan")
  @Header("Cache-Control", "private, no-store, max-age=0")
  step(@Req() req: AdminRequest, @Param("id") id: string, @Body() body: unknown) { return this.service.step(id, body, req.auth.user.id); }
  @Post("batches/:id/video-scan/:scanId/stop")
  @Header("Cache-Control", "private, no-store, max-age=0")
  stop(@Req() req: AdminRequest, @Param("id") id: string, @Param("scanId") scanId: string) { return this.service.cancel(id, scanId, req.auth.user.id); }
}
