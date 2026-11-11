import { BadRequestException, Controller, Injectable, NotFoundException, Post, Param, Body, UseGuards, Header, HttpException, ConflictException, Req } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MetadataImportService } from "./metadata-import.service";
import type { AdminRequest } from "./admin-auth.guard";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { StorageService } from "./storage.service";
import { AdminSessionGuard, CsrfGuard } from "./admin-auth.guard";
import { MetadataAdminGuard } from "./metadata-import.controller";
import { MetadataCoverImages, compareCovers, type CoverFingerprint } from "./metadata-cover-image";

const inputSchema = z.object({ page: z.number().int().min(1).max(100000), after: z.string().max(128).optional(), ceiling: z.string().max(128).optional(), scanId: z.string().uuid().optional() }).strict();
type CoverCandidate = { id: string; publicId: string; title: string; evidence: string[]; cover: { score: number; exact: boolean; thumbnail: string } };

@Injectable()
export class MetadataCoverService {
  private active = 0;
  private scans = new Map<string, { actor: string; batch: string; page: number; after?: string; ceiling?: string; expires: number; done: boolean; failed: number; scanned: number; total: number; matches: Map<string, Set<string>>; busy: boolean }>();
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly images: MetadataCoverImages) {}
  async scan(batchId: string, body: unknown, actorId?: string) {
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ข้อมูลค้นหารูปไม่ถูกต้อง");
    if (this.active >= 2) throw new HttpException("มีการเปรียบเทียบรูปอยู่ กรุณาลองใหม่", 429);
    for (const [key, scan] of this.scans) if (scan.expires < Date.now()) this.scans.delete(key);
    const id = parsed.data.scanId || randomUUID();
    let scan = this.scans.get(id);
    if (actorId) {
      if (!parsed.data.scanId) {
        if (parsed.data.after || parsed.data.ceiling || this.scans.size >= 64) throw new ConflictException("กรุณาเริ่มตรวจรูปใหม่ตั้งแต่ต้น");
        scan = { actor: actorId, batch: batchId, page: parsed.data.page, expires: Date.now()+60*60_000, done: false, failed: 0, scanned: 0, total: 0, matches: new Map(), busy: false };
        this.scans.set(id, scan);
      }
      if (!scan || scan.actor !== actorId || scan.batch !== batchId || scan.page !== parsed.data.page || scan.after !== parsed.data.after || scan.ceiling !== parsed.data.ceiling || scan.done || scan.busy) throw new ConflictException("ลำดับตรวจรูปไม่ถูกต้อง กรุณาเริ่มใหม่");
      scan.busy = true;
    }
    this.active++;
    try {
      const result = await this.page(batchId, parsed.data);
      if (scan) {
        scan.failed += result.failed.length; scan.scanned += result.scanned; scan.total = result.total;
        scan.after = result.next || undefined; scan.ceiling = result.ceiling; scan.done = !result.next;
        for (const row of result.rows) {
          if (row.error) { scan.matches.delete(row.rowId); continue; }
          const matches = scan.matches.get(row.rowId) || new Set<string>();
          for (const video of row.candidates) if (video.cover.exact) matches.add(video.id);
          scan.matches.set(row.rowId, matches);
        }
      }
      const autoRows = scan?.done && !scan.failed && scan.scanned === scan.total
        ? [...scan.matches].filter(([, ids]) => ids.size === 1 && [...scan!.matches.values()].filter(other => other.has([...ids][0]!)).length === 1).map(([rowId]) => rowId) : [];
      return { ...result, scanId: actorId ? id : undefined, autoRows };
    } finally { this.active--; if (scan) scan.busy = false; }
  }
  async applyExact(scanId: string, rowId: string, actor: { id: string; name: string }, imports: MetadataImportService) {
    const scan = this.scans.get(scanId), targets = scan?.matches.get(rowId);
    if (!scan || scan.actor !== actor.id || scan.expires < Date.now() || !scan.done || scan.failed || scan.scanned !== scan.total || targets?.size !== 1) throw new ConflictException("ต้องตรวจครบคลังและพบรูปตรงกันเพียงวิดีโอเดียว");
    if ([...scan.matches.values()].filter(ids => ids.has([...targets][0]!)).length !== 1) throw new ConflictException("หลายบทความใช้รูปปกเดียวกัน จึงไม่เขียนทับอัตโนมัติ");
    if (scan.busy) throw new ConflictException("กำลังบันทึก กรุณารอ");
    scan.busy = true;
    try {
      const row = await this.prisma.metadataImportRow.findUnique({ where: { id: rowId } });
      if (!row || row.batchId !== scan.batch) throw new NotFoundException("ไม่พบรายการ");
      if (["APPLIED", "NOOP"].includes(row.status)) return { rowId, status: row.status, replay: true };
      if (row.status !== "PENDING") throw new ConflictException("รายการนี้ไม่พร้อมนำเข้า");
      const n = row.normalizedJson as { imageUrl?: string; title?: string; description?: string };
      const video = await this.prisma.video.findFirst({ where: { id: [...targets][0], deletedAt: null, status: { notIn: ["DELETING", "DELETED"] } }, select: { id: true, posterKey: true, updatedAt: true } });
      if (!n.imageUrl || !video?.posterKey) throw new ConflictException("รูปปกเปลี่ยนหรือไม่มีแล้ว");
      const fresh = randomUUID();
      const [source, poster] = await Promise.all([
        this.images.load(`verify-source:${fresh}`, async () => n.imageUrl!),
        this.images.load(`verify-poster:${fresh}`, () => this.storage.createReadUrl(video.posterKey!, 120))
      ]);
      if (!compareCovers(source, poster).exact) throw new ConflictException("รูปปกไม่ตรงกันแล้ว จึงไม่แก้ข้อมูลอัตโนมัติ");
      const fields = (["title", "description"] as const).filter(field => n[field]?.trim());
      if (!fields.length) throw new BadRequestException("ไม่มีชื่อเรื่องหรือคำอธิบายที่ไม่ว่าง");
      const proof = { basis: "exact_cover_sha256" as const, sha256: source.sha256, verifiedAt: new Date().toISOString(), videoUpdatedAt: video.updatedAt.toISOString() };
      const plan = await imports.preview(actor, rowId, { targetVideoId: video.id, fields, allowEmpty: false, values: {} }, false, proof);
      return await imports.applyOne(actor, rowId, plan.token);
    } finally { scan.busy = false; }
  }
  private async page(batchId: string, input: z.infer<typeof inputSchema>) {
    if (!await this.prisma.metadataImportBatch.findUnique({ where: { id: batchId }, select: { id: true } })) throw new NotFoundException("ไม่พบ batch");
    const rows = await this.prisma.metadataImportRow.findMany({ where: { batchId }, orderBy: { ordinal: "asc" }, skip: (input.page - 1) * 25, take: 25, select: { id: true, normalizedJson: true, status: true } });
    const sources: { rowId: string; source: string | null; error: string | null; image?: CoverFingerprint; candidates: CoverCandidate[] }[] = [];
    for (let start = 0; start < rows.length; start += 4) await Promise.all(rows.slice(start, start + 4).map(async row => {
      if (row.status !== "PENDING") return;
      const n = row.normalizedJson as { imageUrl?: string };
      if (!n.imageUrl) { sources.push({ rowId: row.id, source: null, error: "ไฟล์ไม่มี URL รูปปกสำหรับเปรียบเทียบ", candidates: [] }); return; }
      try {
        const image = await this.images.load(`source:${n.imageUrl}`, async () => n.imageUrl!);
        sources.push({ rowId: row.id, image, source: image.thumbnail, error: null, candidates: [] });
      } catch (e) { sources.push({ rowId: row.id, source: null, error: e instanceof Error ? e.message : "อ่านรูปต้นทางไม่สำเร็จ", candidates: [] }); }
    }));
    const eligible = { deletedAt: null, status: { notIn: ["DELETING", "DELETED"] as ("DELETING" | "DELETED")[] } };
    const ceiling = input.ceiling ?? (await this.prisma.video.findFirst({ where: eligible, orderBy: { id: "desc" }, select: { id: true } }))?.id ?? "";
    const total = await this.prisma.video.count({ where: { ...eligible, id: { lte: ceiling } } });
    const videos = sources.some(s => s.image) ? await this.prisma.video.findMany({ where: { ...eligible, id: { gt: input.after || "", lte: ceiling } }, orderBy: { id: "asc" }, take: 17, select: { id: true, publicId: true, title: true, posterKey: true, updatedAt: true } }) : [];
    const selected = videos.slice(0, 16);
    let compared = 0, missing = 0;
    const failed: { videoId: string; reason: string }[] = [];
    for (let start = 0; start < selected.length; start += 4) await Promise.all(selected.slice(start, start + 4).map(async video => {
      if (!video.posterKey) { missing++; return; }
      try {
        const image = await this.images.load(`poster:${video.posterKey}:${video.updatedAt.toISOString()}`, () => this.storage.createReadUrl(video.posterKey!, 120));
        compared++;
        for (const source of sources) if (source.image) {
          const match = compareCovers(source.image, image);
          if (match.score >= 85) source.candidates.push({ id: video.id, publicId: video.publicId, title: video.title, cover: { ...match, thumbnail: image.thumbnail }, evidence: [match.exact ? "ไฟล์รูปปกตรงกันทุก byte (SHA-256) — ระบบจะบันทึกอัตโนมัติหลังตรวจครบคลังและไม่พบคู่ซ้ำ" : `ภาพปกคล้าย ${match.score}/100 จากสีและโครงสร้างภาพ — ไม่ใช่ความน่าจะเป็นหรือการยืนยันเนื้อหาวิดีโอ`] });
        }
      } catch (e) { failed.push({ videoId: video.id, reason: e instanceof Error ? e.message : "อ่านรูปปกไม่สำเร็จ" }); }
    }));
    return { ceiling, next: videos.length > 16 ? selected.at(-1)!.id : null, total, scanned: selected.length, compared, missing, failed,
      rows: sources.map(({ image: _image, ...source }) => ({ ...source, candidates: source.candidates.sort((a, b) => b.cover.score - a.cover.score || a.id.localeCompare(b.id)).slice(0, 20) })) };
  }
}

@Controller("metadata-import")
@UseGuards(AdminSessionGuard, MetadataAdminGuard, CsrfGuard)
export class MetadataCoverController {
  constructor(private readonly service: MetadataCoverService, private readonly imports: MetadataImportService) {}
  @Post("batches/:id/cover-scan")
  @Header("Cache-Control", "private, no-store, max-age=0")
  scan(@Param("id") id: string, @Body() body: unknown, @Req() req: AdminRequest) { return this.service.scan(id, body, req.auth.user.id); }
  @Post("rows/:id/auto-cover-apply")
  @Header("Cache-Control", "private, no-store, max-age=0")
  autoApply(@Param("id") id: string, @Body() body: unknown, @Req() req: AdminRequest) {
    const parsed = z.object({ scanId: z.string().uuid() }).strict().safeParse(body);
    if (!parsed.success) throw new BadRequestException("ข้อมูลรอบตรวจรูปไม่ถูกต้อง");
    return this.service.applyExact(parsed.data.scanId, id, req.auth.user, this.imports);
  }
}
