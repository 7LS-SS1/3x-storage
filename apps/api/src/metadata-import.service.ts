import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type MetadataImportRow } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { metadataHash, parseMetadataFile, type NormalizedMetadata } from "./metadata-import.parser";

const fields = ["title", "description", "categoryId", "imageUrl"] as const;
type Field = typeof fields[number];
type Values = { title: string; description: string | null; categoryId: string | null; imageUrl: string | null };
type Snapshot = Values & { videoUpdatedAt: string; imageVersion: number };
type Actor = { id: string; name: string };
type SourceState = { exists: boolean; targetVideoId?: string; rawJson?: Prisma.JsonValue; sourceHash?: string; latestChangeId?: string | null };
type Preview = { targetVideoId: string; publicId: string; before: Snapshot; after: Values; fields: Field[]; warnings: string[]; sourceBefore: SourceState; expiresAt: number };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const previewSchema = z.object({
  targetVideoId: z.string().trim().min(1).max(128),
  fields: z.array(z.enum(fields)).min(1).max(4), allowEmpty: z.boolean().default(false),
  values: z.object({ title: z.string().max(200).optional(), description: z.string().max(100000).nullable().optional(), categoryId: z.string().max(128).nullable().optional(), imageUrl: z.string().max(2048).nullable().optional() }).strict().default({})
}).strict();

@Injectable()
export class MetadataImportService {
  constructor(private readonly prisma: PrismaService) {}

  async stage(actor: Actor, file: { buffer: Buffer; originalname: string }) {
    let parsed: ReturnType<typeof parseMetadataFile>;
    try { parsed = parseMetadataFile(file.buffer, file.originalname); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "อ่านไฟล์ไม่ได้"); }
    return this.prisma.metadataImportBatch.create({
      data: { actorUserId: actor.id, filename: file.originalname.slice(0, 255), format: parsed.format, headerJson: json(parsed.header), rows: { create: parsed.rows.map(row => ({ ordinal: row.ordinal, siteUrl: row.normalized.siteUrl, postId: row.normalized.postId, rawJson: json({ record: row.raw }), normalizedJson: json(row.normalized), errorsJson: json(row.errors), warningsJson: json(row.warnings), status: row.errors.length ? "INVALID" : "PENDING" })) } },
      select: { id: true, filename: true, createdAt: true, _count: { select: { rows: true } } }
    });
  }
  async batches() { return this.prisma.metadataImportBatch.findMany({ orderBy: { createdAt: "desc" }, take: 30, select: { id: true, filename: true, format: true, actorUserId: true, createdAt: true, _count: { select: { rows: true } } } }); }
  async batch(id: string, page: number) {
    const batch = await this.prisma.metadataImportBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException("ไม่พบ batch");
    const [rows, total] = await Promise.all([
      this.prisma.metadataImportRow.findMany({ where: { batchId: id }, orderBy: { ordinal: "asc" }, skip: (page - 1) * 25, take: 25, select: { id: true, ordinal: true, siteUrl: true, postId: true, normalizedJson: true, errorsJson: true, warningsJson: true, status: true } }),
      this.prisma.metadataImportRow.count({ where: { batchId: id } })
    ]);
    return { batch, rows, total, page };
  }
  async detail(id: string) {
    const row = await this.prisma.metadataImportRow.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("ไม่พบรายการ");
    const source = row.siteUrl && row.postId ? await this.prisma.wordPressMetadataSource.findUnique({ where: { siteUrl_postId: { siteUrl: row.siteUrl, postId: row.postId } } }) : null;
    return { row, existingMapping: source?.active ? source.targetVideoId : null };
  }
  async targets(id: string) {
    // Exact ID/publicId lookup only. Never fuzzy title matching.
    return this.prisma.video.findMany({ where: { OR: [{ id }, { publicId: id }], deletedAt: null, status: { notIn: ["DELETING", "DELETED"] } }, select: { id: true, publicId: true, title: true, description: true, categoryId: true }, take: 2 });
  }
  private assertPending(row: MetadataImportRow | null): asserts row is MetadataImportRow {
    if (!row) throw new NotFoundException("ไม่พบรายการ");
    if (row.status !== "PENDING" || !row.siteUrl || !row.postId) throw new ConflictException("รายการนี้ไม่อยู่ในสถานะรอตรวจสอบ");
  }
  private async snapshot(tx: Prisma.TransactionClient, videoId: string) {
    const video = await tx.video.findFirst({ where: { id: videoId, deletedAt: null, status: { notIn: ["DELETING", "DELETED"] } }, select: { id: true, publicId: true, title: true, description: true, categoryId: true, updatedAt: true, metadataImage: true } });
    if (!video) throw new NotFoundException("ไม่พบ Video ID ที่เลือก หรือวิดีโอกำลังถูกลบ");
    return { publicId: video.publicId, snapshot: { title: video.title, description: video.description, categoryId: video.categoryId, imageUrl: video.metadataImage?.imageUrl ?? null, imageVersion: video.metadataImage?.version ?? 0, videoUpdatedAt: video.updatedAt.toISOString() } satisfies Snapshot };
  }
  private sourceState(source: { active: boolean; targetVideoId: string; rawJson: Prisma.JsonValue; sourceHash: string; latestChangeId: string | null } | null): SourceState {
    return source?.active ? { exists: true, targetVideoId: source.targetVideoId, rawJson: source.rawJson, sourceHash: source.sourceHash, latestChangeId: source.latestChangeId } : { exists: false };
  }
  async preview(actor: Actor, rowId: string, body: unknown) {
    const parsed = previewSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ข้อมูลตรวจสอบไม่ถูกต้อง ต้องเลือก Video ID และฟิลด์ที่ต้องการแก้");
    const input = parsed.data;
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "MetadataImportRow" WHERE id=${rowId} FOR UPDATE`;
      const row = await tx.metadataImportRow.findUnique({ where: { id: rowId } }); this.assertPending(row);
      const n = row.normalizedJson as unknown as NormalizedMetadata;
      const { publicId, snapshot: before } = await this.snapshot(tx, input.targetVideoId);
      const source = await tx.wordPressMetadataSource.findUnique({ where: { siteUrl_postId: { siteUrl: row.siteUrl!, postId: row.postId! } } });
      if (source?.active && source.targetVideoId !== input.targetVideoId) throw new ConflictException("คีย์ต้นทางนี้เคยจับคู่กับ Video ID อื่น ต้องย้อนคืนรายการเดิมก่อนเปลี่ยนคู่");
      const after: Values = { title: before.title, description: before.description, categoryId: before.categoryId, imageUrl: before.imageUrl };
      const candidates: Partial<Values> = { title: n.title, description: n.description, imageUrl: n.imageUrl, ...input.values };
      const warnings = [...(row.warningsJson as string[])];
      for (const field of [...new Set(input.fields)]) {
        const value = candidates[field];
        if (value === undefined) throw new BadRequestException(`ไม่มีค่าที่ระบุสำหรับ ${field}`);
        if (value === null || !value.trim()) {
          if (!input.allowEmpty) { warnings.push(`ไม่เปลี่ยน ${field} เพราะค่าว่าง (ค่าเริ่มต้นไม่เขียนทับ)`); continue; }
          if (field === "title") throw new BadRequestException("ไม่อนุญาตให้ล้างชื่อวิดีโอ");
          after[field] = null;
        } else if (field === "title") after.title = value;
        else after[field] = value;
      }
      if (after.categoryId !== before.categoryId && after.categoryId && !await tx.category.findFirst({ where: { id: after.categoryId, active: true }, select: { id: true } })) throw new BadRequestException("หมวดหมู่ที่เลือกไม่มีอยู่หรือถูกปิดใช้งาน");
      if (after.imageUrl) {
        try { const url = new URL(after.imageUrl); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
        catch { throw new BadRequestException("URL รูปต้องเป็น HTTP(S) ไม่มี credentials"); }
      }
      const plan: Preview = { targetVideoId: input.targetVideoId, publicId, before, after, fields: fields.filter(f => before[f] !== after[f]), warnings, sourceBefore: this.sourceState(source), expiresAt: Date.now() + 15 * 60 * 1000 };
      const token = randomUUID();
      await tx.metadataImportRow.update({ where: { id: rowId }, data: { previewJson: json(plan), previewToken: token, previewActorId: actor.id } });
      return { rowId, token, ...plan };
    });
  }
  private async lockVideoAndSource(tx: Prisma.TransactionClient, videoId: string, siteUrl: string, postId: string) {
    await tx.$queryRaw`SELECT id FROM "Video" WHERE id=${videoId} FOR UPDATE`;
    // Source may not exist yet; a transaction-scoped lock serializes first imports too.
    const key = `${siteUrl}\n${postId}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text`;
  }
  private async writeValues(tx: Prisma.TransactionClient, videoId: string, values: Values, changed: Field[]) {
    const data: Prisma.VideoUpdateInput = {};
    if (changed.includes("title")) data.title = values.title;
    if (changed.includes("description")) data.description = values.description;
    if (changed.includes("categoryId")) data.category = values.categoryId ? { connect: { id: values.categoryId } } : { disconnect: true };
    if (Object.keys(data).length) await tx.video.update({ where: { id: videoId }, data });
    if (changed.includes("imageUrl")) await tx.videoMetadataImage.upsert({ where: { videoId }, create: { videoId, imageUrl: values.imageUrl, version: 1 }, update: { imageUrl: values.imageUrl, version: { increment: 1 } } });
  }
  async applyOne(actor: Actor, rowId: string, token: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "MetadataImportRow" WHERE id=${rowId} FOR UPDATE`;
      const row = await tx.metadataImportRow.findUnique({ where: { id: rowId } });
      if (!row) throw new NotFoundException("ไม่พบรายการ");
      if (row.previewToken !== token || row.previewActorId !== actor.id) throw new ConflictException("ต้องตรวจตัวอย่างด้วยบัญชีนี้ก่อนยืนยัน");
      if (["APPLIED", "NOOP"].includes(row.status)) return { rowId, status: row.status, replay: true };
      this.assertPending(row);
      const plan = row.previewJson as unknown as Preview;
      if (!plan || plan.expiresAt < Date.now()) throw new ConflictException("ตัวอย่างหมดอายุ กรุณาตรวจใหม่");
      await this.lockVideoAndSource(tx, plan.targetVideoId, row.siteUrl!, row.postId!);
      const current = await this.snapshot(tx, plan.targetVideoId);
      if (metadataHash(current.snapshot) !== metadataHash(plan.before)) throw new ConflictException("ข้อมูลวิดีโอเปลี่ยนหลังตรวจตัวอย่าง กรุณาตรวจใหม่");
      const existing = await tx.wordPressMetadataSource.findUnique({ where: { siteUrl_postId: { siteUrl: row.siteUrl!, postId: row.postId! } } });
      if (metadataHash(this.sourceState(existing)) !== metadataHash(plan.sourceBefore)) throw new ConflictException("ข้อมูลต้นทางถูกนำเข้าโดยรายการอื่นแล้ว กรุณาตรวจใหม่");
      if (plan.after.categoryId !== plan.before.categoryId && plan.after.categoryId && !await tx.category.findFirst({ where: { id: plan.after.categoryId, active: true } })) throw new ConflictException("หมวดหมู่ถูกเปลี่ยนหรือปิดใช้งาน กรุณาตรวจใหม่");
      const sourceHash = metadataHash(row.rawJson);
      if (!plan.fields.length && existing?.active && existing.sourceHash === sourceHash) {
        await tx.metadataImportRow.update({ where: { id: rowId }, data: { status: "NOOP" } });
        return { rowId, status: "NOOP", replay: false };
      }
      await this.writeValues(tx, plan.targetVideoId, plan.after, plan.fields);
      const after = (await this.snapshot(tx, plan.targetVideoId)).snapshot;
      const source = await tx.wordPressMetadataSource.upsert({ where: { siteUrl_postId: { siteUrl: row.siteUrl!, postId: row.postId! } }, create: { siteUrl: row.siteUrl!, postId: row.postId!, targetVideoId: plan.targetVideoId, rawJson: json(row.rawJson), sourceHash }, update: { targetVideoId: plan.targetVideoId, rawJson: json(row.rawJson), sourceHash, active: true } });
      const change = await tx.metadataChange.create({ data: { rowId, sourceId: source.id, videoId: plan.targetVideoId, actorUserId: actor.id, actorName: actor.name, beforeJson: json(plan.before), afterJson: json(after), fieldsJson: json(plan.fields), sourceBefore: json(plan.sourceBefore), sourceAfter: json({ targetVideoId: plan.targetVideoId, sourceHash, rawJson: row.rawJson }) } });
      await tx.wordPressMetadataSource.update({ where: { id: source.id }, data: { latestChangeId: change.id } });
      await tx.metadataImportRow.update({ where: { id: rowId }, data: { status: "APPLIED" } });
      await tx.auditLog.create({ data: { actorUserId: actor.id, action: "WORDPRESS_METADATA_APPLIED", entityType: "Video", entityId: plan.targetVideoId, metadataJson: { batchId: row.batchId, rowId, changeId: change.id, fields: plan.fields } } });
      return { rowId, status: "APPLIED", changeId: change.id, replay: false };
    }, { timeout: 15000 });
  }
  async history(page: number) {
    const [changes, total] = await Promise.all([this.prisma.metadataChange.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * 25, take: 25, select: { id: true, videoId: true, actorUserId: true, actorName: true, beforeJson: true, afterJson: true, fieldsJson: true, createdAt: true, revertedAt: true, revertedById: true, row: { select: { batchId: true, siteUrl: true, postId: true } } } }), this.prisma.metadataChange.count()]);
    return { changes, total, page };
  }
  async rollback(actor: Actor, changeId: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "MetadataChange" WHERE id=${changeId} FOR UPDATE`;
      const change = await tx.metadataChange.findUnique({ where: { id: changeId }, include: { source: true, row: true } });
      if (!change) throw new NotFoundException("ไม่พบประวัติ");
      if (change.revertedAt) return { reverted: true, replay: true };
      await this.lockVideoAndSource(tx, change.videoId, change.source.siteUrl, change.source.postId);
      const current = (await this.snapshot(tx, change.videoId)).snapshot;
      const source = await tx.wordPressMetadataSource.findUniqueOrThrow({ where: { id: change.sourceId } });
      const metadataValues = (value: Snapshot) => ({ title: value.title, description: value.description, categoryId: value.categoryId, imageUrl: value.imageUrl });
      if (source.latestChangeId !== changeId || metadataHash(metadataValues(current)) !== metadataHash(metadataValues(change.afterJson as unknown as Snapshot))) throw new ConflictException("มีการแก้ไขหลังรายการนี้ จึงย้อนคืนไม่ได้โดยไม่ทับงานใหม่ กรุณาตรวจประวัติ");
      const before = change.beforeJson as unknown as Snapshot;
      if (before.categoryId && !await tx.category.findUnique({ where: { id: before.categoryId } })) throw new ConflictException("หมวดหมู่เดิมถูกลบ ไม่สามารถย้อนคืนได้");
      await this.writeValues(tx, change.videoId, before, change.fieldsJson as Field[]);
      const old = change.sourceBefore as unknown as SourceState;
      await tx.wordPressMetadataSource.update({ where: { id: source.id }, data: old.exists ? { targetVideoId: old.targetVideoId!, rawJson: json(old.rawJson), sourceHash: old.sourceHash!, latestChangeId: old.latestChangeId, active: true } : { active: false, latestChangeId: null } });
      await tx.metadataChange.update({ where: { id: changeId }, data: { revertedAt: new Date(), revertedById: actor.id } });
      await tx.metadataImportRow.update({ where: { id: change.rowId }, data: { status: "ROLLED_BACK" } });
      await tx.auditLog.create({ data: { actorUserId: actor.id, action: "WORDPRESS_METADATA_ROLLED_BACK", entityType: "Video", entityId: change.videoId, metadataJson: { batchId: change.row.batchId, changeId, before: json(current), after: json((await this.snapshot(tx, change.videoId)).snapshot) } } });
      return { reverted: true, replay: false };
    }, { timeout: 15000 });
  }
}
