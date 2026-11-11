import { BadRequestException, Body, ConflictException, Controller, Get, Header, Injectable, NotFoundException, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Prisma, type MetadataVideoTask } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { AdminSessionGuard, CsrfGuard, type AdminRequest } from "./admin-auth.guard";
import { MetadataAdminGuard } from "./metadata-import.controller";

export const videoJobInput = z.object({ threshold: z.number().int().min(70).max(95).default(80), samples: z.union([z.literal(12), z.literal(30), z.literal(60)]).default(30), restart: z.boolean().default(false) }).strict();
export const videoEligibility = { deletedAt: null, posterKey: null, status: { in: ["UPLOADED", "PROCESSING", "READY"] as ("UPLOADED" | "PROCESSING" | "READY")[] } };
export const LEASE_MS = 90_000;
export type ClaimedTask = MetadataVideoTask & { leaseToken: string };

@Injectable()
export class MetadataVideoJobs {
  constructor(private readonly prisma: PrismaService) {}

  async start(batchId: string, actorUserId: string, body: unknown) {
    const parsed = videoJobInput.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ตั้งค่าตรวจวิดีโอไม่ถูกต้อง");
    const { threshold, samples, restart } = parsed.data;
    return this.prisma.$transaction(async tx => {
      // Serialize start/retry from double clicks without holding locks during media I/O.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${batchId + ':' + actorUserId}))`;
      const old = await tx.metadataVideoJob.findUnique({ where: { batchId_actorUserId: { batchId, actorUserId } } });
      if (old && !restart) return { jobId: old.id };
      if (old) {
        const locked = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "MetadataVideoJob" WHERE id=${old.id} FOR UPDATE`;
        if (locked[0]?.status === "RUNNING") throw new ConflictException("หยุดงานเดิมก่อนเริ่มรอบใหม่");
      }
      if (!await tx.metadataImportBatch.findUnique({ where: { id: batchId }, select: { id: true } })) throw new NotFoundException("ไม่พบ batch");
      const rows = await tx.metadataImportRow.findMany({ where: { batchId, status: "PENDING" }, select: { id: true }, take: 501 });
      if (rows.length > 500) throw new BadRequestException("batch ต้องไม่เกิน 500 รายการ");
      if (old) await tx.metadataVideoJob.delete({ where: { id: old.id } });
      const job = await tx.metadataVideoJob.create({ data: { batchId, actorUserId, threshold, samples } });
      if (rows.length) {
        await tx.metadataVideoTask.createMany({ data: rows.map(row => ({ jobId: job.id, kind: "SOURCE", refId: row.id })) });
        // Freeze membership once; this is a queue snapshot, not a lock on Video records.
        await tx.$executeRaw`INSERT INTO "MetadataVideoTask" ("id","jobId","kind","refId","updatedAt")
          SELECT ${job.id} || ':' || "id", ${job.id}, 'VIDEO', "id", CURRENT_TIMESTAMP FROM "Video"
          WHERE "deletedAt" IS NULL AND "posterKey" IS NULL AND "status" IN ('UPLOADED','PROCESSING','READY')`;
      } else await tx.metadataVideoJob.update({ where: { id: job.id }, data: { status: "COMPLETED" } });
      return { jobId: job.id };
    }, { timeout: 20_000 });
  }

  async control(batchId: string, actorUserId: string, action: string) {
    if (!["pause", "resume", "retry"].includes(action)) throw new BadRequestException("คำสั่งไม่ถูกต้อง");
    return this.prisma.$transaction(async tx => {
      const jobs = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT "id","status" FROM "MetadataVideoJob" WHERE "batchId"=${batchId} AND "actorUserId"=${actorUserId} FOR UPDATE`;
      const job = jobs[0]; if (!job) throw new NotFoundException("ไม่พบงานตรวจ");
      if (action === "retry") {
        if (job.status === "RUNNING") throw new ConflictException("พักงานก่อนลองรายการที่ผิดพลาด");
        if (await tx.metadataVideoTask.count({ where: { jobId: job.id, status: "RUNNING", leaseUntil: { gt: new Date() } } })) throw new ConflictException("กำลังพักงาน รอเฟรมปัจจุบันเสร็จก่อนลองใหม่");
        // A recovered source must also be compared with previously completed videos.
        const sourceFailed = await tx.metadataVideoTask.count({ where: { jobId: job.id, kind: "SOURCE", status: "FAILED" } });
        await tx.metadataVideoTask.updateMany({ where: { jobId: job.id, OR: [{ status: "FAILED" }, ...(sourceFailed ? [{ kind: "VIDEO", status: "DONE" }] : [])] }, data: { status: "PENDING", attempts: 0, error: null, runAfter: new Date() } });
      }
      if (job.status !== "COMPLETED" || action === "retry") await tx.metadataVideoJob.update({ where: { id: job.id }, data: { status: action === "pause" ? "PAUSED" : "RUNNING" } });
      return { jobId: job.id };
    });
  }

  async status(batchId: string, actorUserId: string, page: number) {
    const job = await this.prisma.metadataVideoJob.findUnique({ where: { batchId_actorUserId: { batchId, actorUserId } } });
    if (!job) return { job: null, rows: [] };
    const [groups, activity, current, failures, rows] = await Promise.all([
      this.prisma.metadataVideoTask.groupBy({ by: ["kind", "status"], where: { jobId: job.id }, _count: true, _sum: { framesDone: true, cacheHits: true } }),
      this.prisma.metadataVideoTask.aggregate({ where: { jobId: job.id }, _max: { updatedAt: true } }),
      this.prisma.metadataVideoTask.findMany({ where: { jobId: job.id, kind: "VIDEO", status: "RUNNING", leaseUntil: { gt: new Date() } }, select: { refId: true, framesDone: true }, take: 4 }),
      this.prisma.metadataVideoTask.findMany({ where: { jobId: job.id, status: "FAILED" }, select: { refId: true, kind: true, error: true }, take: 100, orderBy: { updatedAt: "desc" } }),
      this.prisma.metadataImportRow.findMany({ where: { batchId }, select: { id: true }, orderBy: { ordinal: "asc" }, skip: (page - 1) * 25, take: 25 })
    ]);
    const ids = rows.map(row => row.id);
    const [sources, matches] = await Promise.all([
      this.prisma.metadataVideoTask.findMany({ where: { jobId: job.id, kind: "SOURCE", refId: { in: ids } }, select: { refId: true, dataJson: true, error: true } }),
      this.prisma.metadataVideoMatch.findMany({ where: { jobId: job.id, rowId: { in: ids } }, orderBy: [{ score: "desc" }, { videoId: "asc" }] })
    ]);
    const videos = await this.prisma.video.findMany({ where: { id: { in: [...new Set(matches.map(m => m.videoId))] }, deletedAt: null, status: { notIn: ["DELETED", "DELETING"] } }, select: { id: true, publicId: true, title: true } });
    const count = (kind: string, statuses?: string[]) => groups.filter(g => g.kind === kind && (!statuses || statuses.includes(g.status))).reduce((n, g) => n + g._count, 0);
    return {
      job: { id: job.id, status: job.status, threshold: job.threshold, samples: job.samples, createdAt: job.createdAt, lastActivityAt: activity._max.updatedAt || job.createdAt,
        sourceTotal: count("SOURCE"), loaded: count("SOURCE", ["DONE", "FAILED"]), total: count("VIDEO"), scanned: count("VIDEO", ["DONE", "FAILED"]), failed: count("VIDEO", ["FAILED"]), sourceFailed: count("SOURCE", ["FAILED"]),
        frames: groups.reduce((n, g) => n + (g._sum.framesDone || 0), 0), cached: groups.reduce((n, g) => n + (g._sum.cacheHits || 0), 0), current, failures },
      rows: ids.map(rowId => {
        const source = sources.find(s => s.refId === rowId);
        return { rowId, source: (source?.dataJson as { source?: string })?.source || null, error: source?.error || null, candidates: matches.filter(m => m.rowId === rowId).flatMap(m => {
          const video = videos.find(v => v.id === m.videoId); if (!video) return [];
          return [{ ...video, evidence: [`เฟรมที่ ${m.seconds.toFixed(1)} วินาที • ${m.panel} • คะแนนความคล้าย ${m.score}/100 (ไม่ใช่ความน่าจะเป็น)`], frame: { seconds: m.seconds, panel: m.panel }, cover: { score: m.score, exact: false, thumbnail: m.thumbnail } }]; }) };
      })
    };
  }

  async claim(concurrency: number): Promise<ClaimedTask | null> {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(71493021)`;
      const active = await tx.metadataVideoTask.count({ where: { status: "RUNNING", leaseUntil: { gt: new Date() } } });
      if (active >= Math.min(4, Math.max(1, concurrency))) return null;
      const rows = await tx.$queryRaw<MetadataVideoTask[]>`SELECT t.* FROM "MetadataVideoTask" t JOIN "MetadataVideoJob" j ON j.id=t."jobId"
        WHERE j.status='RUNNING' AND ((t.status='PENDING' AND t."runAfter"<=CURRENT_TIMESTAMP) OR (t.status='RUNNING' AND t."leaseUntil"<CURRENT_TIMESTAMP))
        AND (t.kind='SOURCE' OR NOT EXISTS (SELECT 1 FROM "MetadataVideoTask" s WHERE s."jobId"=t."jobId" AND s.kind='SOURCE' AND s.status NOT IN ('DONE','FAILED')))
        ORDER BY j."createdAt", CASE WHEN t.kind='SOURCE' THEN 0 ELSE 1 END, t."refId" LIMIT 1 FOR UPDATE OF t SKIP LOCKED`;
      if (!rows[0]) return null;
      const task = await tx.metadataVideoTask.update({ where: { id: rows[0].id }, data: { status: "RUNNING", leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + LEASE_MS), attempts: { increment: 1 } } });
      return task as ClaimedTask;
    });
  }

  async renew(task: ClaimedTask, data: Prisma.MetadataVideoTaskUpdateManyMutationInput = {}) {
    const result = await this.prisma.metadataVideoTask.updateMany({ where: { id: task.id, leaseToken: task.leaseToken, status: "RUNNING", leaseUntil: { gt: new Date() }, job: { status: "RUNNING" } }, data: { ...data, leaseUntil: data.status === "DONE" ? null : new Date(Date.now() + LEASE_MS) } });
    return result.count === 1;
  }

  async release(task: ClaimedTask, error?: string) {
    await this.prisma.metadataVideoTask.updateMany({ where: { id: task.id, leaseToken: task.leaseToken, status: "RUNNING" }, data: { status: error && task.attempts >= 3 ? "FAILED" : "PENDING", error: error || null, leaseToken: null, leaseUntil: null, runAfter: new Date(Date.now() + (error ? 5000 : 1000)) } });
  }

  async finishJobs() {
    await this.prisma.$executeRaw`UPDATE "MetadataVideoJob" j SET status='COMPLETED', "updatedAt"=CURRENT_TIMESTAMP WHERE j.status='RUNNING'
      AND NOT EXISTS (SELECT 1 FROM "MetadataVideoTask" t WHERE t."jobId"=j.id AND t.status NOT IN ('DONE','FAILED'))`;
  }
}

@Controller("metadata-import")
@UseGuards(AdminSessionGuard, MetadataAdminGuard, CsrfGuard)
export class MetadataVideoJobsController {
  constructor(private readonly jobs: MetadataVideoJobs) {}
  @Post("batches/:id/video-job") @Header("Cache-Control", "private, no-store")
  start(@Req() req: AdminRequest, @Param("id") id: string, @Body() body: unknown) { return this.jobs.start(id, req.auth.user.id, body); }
  @Get("batches/:id/video-job") @Header("Cache-Control", "private, no-store")
  status(@Req() req: AdminRequest, @Param("id") id: string, @Query("page") value?: string) {
    const page = z.coerce.number().int().min(1).max(100000).default(1).safeParse(value);
    if (!page.success) throw new BadRequestException("หน้าไม่ถูกต้อง");
    return this.jobs.status(id, req.auth.user.id, page.data);
  }
  @Post("batches/:id/video-job/:action") @Header("Cache-Control", "private, no-store")
  control(@Req() req: AdminRequest, @Param("id") id: string, @Param("action") action: string) { return this.jobs.control(id, req.auth.user.id, action); }
}
