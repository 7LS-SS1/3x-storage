import { BadRequestException, Controller, Injectable, NotFoundException, Post, Param, Body, UseGuards, Header, HttpException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { StorageService } from "./storage.service";
import { AdminSessionGuard, CsrfGuard } from "./admin-auth.guard";
import { MetadataAdminGuard } from "./metadata-import.controller";
import { MetadataCoverImages, compareCovers, type CoverFingerprint } from "./metadata-cover-image";

const inputSchema = z.object({ page: z.number().int().min(1).max(100000), after: z.string().max(128).optional(), ceiling: z.string().max(128).optional() }).strict();
type CoverCandidate = { id: string; publicId: string; title: string; evidence: string[]; cover: { score: number; exact: boolean; thumbnail: string } };

@Injectable()
export class MetadataCoverService {
  private active = 0;
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly images: MetadataCoverImages) {}
  async scan(batchId: string, body: unknown) {
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ข้อมูลค้นหารูปไม่ถูกต้อง");
    if (this.active >= 2) throw new HttpException("มีการเปรียบเทียบรูปอยู่ กรุณาลองใหม่", 429);
    this.active++;
    try { return await this.page(batchId, parsed.data); } finally { this.active--; }
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
          if (match.score >= 85) source.candidates.push({ id: video.id, publicId: video.publicId, title: video.title, cover: { ...match, thumbnail: image.thumbnail }, evidence: [match.exact ? "ไฟล์รูปปกตรงกันทุก byte (SHA-256) — ยังต้องเล่นตรวจวิดีโอ" : `ภาพปกคล้าย ${match.score}/100 จากสีและโครงสร้างภาพ — ไม่ใช่ความน่าจะเป็นหรือการยืนยันเนื้อหาวิดีโอ`] });
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
  constructor(private readonly service: MetadataCoverService) {}
  @Post("batches/:id/cover-scan")
  @Header("Cache-Control", "private, no-store, max-age=0")
  scan(@Param("id") id: string, @Body() body: unknown) { return this.service.scan(id, body); }
}
