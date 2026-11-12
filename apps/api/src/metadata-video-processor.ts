import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaService } from "./prisma.service";
import { StorageService } from "./storage.service";
import { compareCovers, fetchCoverBytes, type CoverFingerprint } from "./metadata-cover-image";
import { MetadataVideoFrames, detailedImage, sampleTimes, sourcePanels } from "./metadata-video-frames";
import { LEASE_MS, MetadataVideoJobs, videoEligibility, type ClaimedTask } from "./metadata-video-jobs.service";
import { MetadataImportService } from "./metadata-import.service";

export type PackedImage = Omit<CoverFingerprint, "pixels" | "edges"> & { pixels: string; edges: string };
export const packImage = (image: CoverFingerprint): PackedImage => ({ ...image, pixels: image.pixels.toString("base64"), edges: image.edges.toString("base64") });
export const unpackImage = (image: PackedImage): CoverFingerprint => ({ ...image, pixels: Buffer.from(image.pixels, "base64"), edges: Buffer.from(image.edges, "base64") });
export const frameIdentity = (videoId: string, key: string, version: { etag: string; size: number; bucket: string; endpoint: string }) => createHash("sha256").update(JSON.stringify(["frame-v1", videoId, key, version])).digest("hex");
const json = (value: unknown) => value as Prisma.InputJsonValue;
class Interrupted extends Error {}
type PreparedSource = { rowId: string; targetVideoId?: string; panels: { label: string; image: CoverFingerprint }[] };

@Injectable()
export class MetadataVideoProcessor {
  stopping = false;
  private sourceCache = new Map<string, PreparedSource[]>();
  private lastTrim = 0;
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly frames: MetadataVideoFrames, private readonly jobs: MetadataVideoJobs) {}

  async run(concurrency = 2) {
    const limit = Number.isFinite(concurrency) ? Math.min(4, Math.max(1, Math.floor(concurrency))) : 2;
    await Promise.all(Array.from({ length: limit }, async () => {
      while (!this.stopping) {
        try {
          const task = await this.jobs.claim(limit);
          if (task) await this.process(task);
          else { await this.jobs.finishJobs(); await this.trimCache(); await delay(1000); }
        } catch { console.error("Metadata video worker: retrying database operation"); await delay(3000); }
      }
    }));
  }

  async process(task: ClaimedTask) {
    try {
      if (this.stopping || !await this.jobs.renew(task)) throw new Interrupted();
      if (task.kind === "SOURCE") await this.prepareSource(task);
      else await this.processVideo(task);
    } catch (error) {
      await this.jobs.release(task, error instanceof Interrupted ? undefined : error instanceof ConflictException ? `ตรวจเฟรม: ${error.message}` : error instanceof Error && error.message.startsWith("ตรวจเฟรม:") ? error.message : "ตรวจเฟรม: อ่านไฟล์หรือประมวลผลไม่สำเร็จ จะลองใหม่ไม่เกิน 3 ครั้ง");
    }
    await this.jobs.finishJobs();
    await this.trimCache();
  }

  private async prepareSource(task: ClaimedTask) {
    const row = await this.prisma.metadataImportRow.findFirst({ where: { id: task.refId, batchId: (await this.prisma.metadataVideoJob.findUniqueOrThrow({ where: { id: task.jobId } })).batchId }, select: { normalizedJson: true } });
    const url = (row?.normalizedJson as { imageUrl?: string })?.imageUrl;
    if (!url) throw new Error("ตรวจเฟรม: ไม่มีรูปต้นทางในรายการนี้");
    const panels = await sourcePanels(await fetchCoverBytes(url));
    const useful = panels.filter(p => detailedImage(p.image));
    if (!useful.length) throw new Error("ตรวจเฟรม: รูปต้นทางไม่มีรายละเอียดพอสำหรับเทียบเฟรม");
    const payload = { source: panels[0]!.image.thumbnail, targetVideoId: (row?.normalizedJson as { targetVideoId?: string })?.targetVideoId || null, panels: useful.map(p => ({ label: p.label, image: { ...packImage(p.image), thumbnail: "" } })) };
    if (!await this.jobs.renew(task, { status: "DONE", error: null, dataJson: json(payload), leaseToken: null })) throw new Interrupted();
  }

  private async sources(jobId: string, version: Date) {
    const cacheKey = `${jobId}:${version.getTime()}`;
    if (this.sourceCache.has(cacheKey)) return this.sourceCache.get(cacheKey)!;
    const rows = await this.prisma.metadataVideoTask.findMany({ where: { jobId, kind: "SOURCE", status: "DONE" }, select: { refId: true, dataJson: true } });
    const sources = rows.map(row => ({ rowId: row.refId, targetVideoId: (row.dataJson as { targetVideoId?: string }).targetVideoId, panels: ((row.dataJson as { panels?: { label: string; image: PackedImage }[] }).panels || []).map(p => ({ label: p.label, image: unpackImage(p.image) })) }));
    this.sourceCache.set(cacheKey, sources);
    while (this.sourceCache.size > 4) this.sourceCache.delete(this.sourceCache.keys().next().value!);
    return sources;
  }

  private async processVideo(task: ClaimedTask) {
    const job = await this.prisma.metadataVideoJob.findUniqueOrThrow({ where: { id: task.jobId } });
    const prepared = await this.sources(job.id, job.updatedAt);
    const pendingSources = async () => {
      const rows = await this.prisma.metadataImportRow.findMany({ where: { id: { in: prepared.map(s => s.rowId) }, status: "PENDING" }, select: { id: true, siteUrl: true, postId: true } });
      return prepared.filter(s => (!s.targetVideoId || s.targetVideoId === task.refId) && rows.some(r => r.id === s.rowId));
    };
    if (!(await pendingSources()).some(s => s.panels.length)) { await this.jobs.renew(task, { status: "SKIPPED", leaseToken: null }); return; }
    if (await this.prisma.wordPressMetadataSource.count({ where: { targetVideoId: task.refId, active: true } })) {
      await this.jobs.renew(task, { status: "SKIPPED", leaseToken: null }); return;
    }
    const video = await this.prisma.video.findFirst({ where: { ...videoEligibility, id: task.refId }, select: { id: true, originalKey: true, files: { where: { role: "ORIGINAL" }, orderBy: { createdAt: "desc" }, take: 1, select: { storageKey: true } } } });
    const key = video?.files[0]?.storageKey || video?.originalKey;
    if (!key) throw new Error("ตรวจเฟรม: วิดีโอถูกเปลี่ยน/ลบ มีปกแล้ว หรือไม่มีไฟล์ต้นฉบับ");
    const version = await this.storage.objectVersion(key);
    const identity = frameIdentity(task.refId, key, version);
    await this.prisma.metadataVideoIndex.upsert({ where: { id: identity }, create: { id: identity, videoId: task.refId }, update: {} });
    const acquired = await this.prisma.metadataVideoIndex.updateMany({ where: { id: identity, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { leaseToken: task.leaseToken, leaseUntil: new Date(Date.now() + LEASE_MS) } });
    if (!acquired.count) throw new Interrupted(); // Another job is building this same object's index.
    try {
      const index = await this.prisma.metadataVideoIndex.findUniqueOrThrow({ where: { id: identity } });
      const duration = index.duration || await this.frames.duration(key, version.etag);
      const times = sampleTimes(duration, job.samples).map(t => Math.round(t * 1000));
      if (!await this.jobs.renew(task, { objectIdentity: identity, framesDone: 0, cacheHits: 0 })) throw new Interrupted();
      const records = await this.prisma.metadataVideoFrame.findMany({ where: { identity, timeMs: { in: times } } });
      const cached = new Map(records.map(r => [r.timeMs, unpackImage(r.imageJson as unknown as PackedImage)]));
      let hits = 0;
      for (const [i, timeMs] of times.entries()) {
        if (this.stopping || !await this.jobs.renew(task)) throw new Interrupted();
        if (await this.prisma.wordPressMetadataSource.count({ where: { targetVideoId: task.refId, active: true } })) {
          await this.jobs.renew(task, { status: "SKIPPED", leaseToken: null }); return;
        }
        const sources = await pendingSources();
        if (!sources.length) { await this.jobs.renew(task, { status: "DONE", leaseToken: null }); return; }
        let image = cached.get(timeMs);
        if (image) hits++;
        else {
          image = await this.frames.frame(key, timeMs / 1000, version.etag);
          // The object ETag is checked by every range GET. Fence stale workers before caching.
          await this.prisma.$transaction(async tx => {
            const lease = await tx.metadataVideoIndex.updateMany({ where: { id: identity, leaseToken: task.leaseToken, leaseUntil: { gt: new Date() } }, data: { duration, leaseUntil: new Date(Date.now() + LEASE_MS) } });
            if (!lease.count) throw new Interrupted();
            await tx.metadataVideoFrame.upsert({ where: { identity_timeMs: { identity, timeMs } }, create: { id: `${identity}:${timeMs}`, identity, timeMs, imageJson: json(packImage(image!)) }, update: { imageJson: json(packImage(image!)), lastUsedAt: new Date() } });
          });
        }
        await this.prisma.metadataVideoIndex.updateMany({ where: { id: identity, leaseToken: task.leaseToken }, data: { duration, leaseUntil: new Date(Date.now() + LEASE_MS) } });
        if (!await this.jobs.renew(task, { framesDone: i + 1, cacheHits: hits })) throw new Interrupted();
        if (cached.has(timeMs)) await this.prisma.metadataVideoFrame.updateMany({ where: { identity, timeMs }, data: { lastUsedAt: new Date() } });
        if (job.threshold > 0 && !detailedImage(image)) continue;
        const ranked = sources.map(source => {
          const best = source.panels.map(panel => ({ panel: panel.label, score: compareCovers(panel.image, image!).score })).sort((a,b) => b.score-a.score)[0];
          return { rowId: source.rowId, ...best! };
        }).filter(match => match.score >= job.threshold).sort((a,b) => (job.threshold === 0 ? 0 : b.score-a.score) || a.rowId.localeCompare(b.rowId));
        for (const match of ranked) {
          if (frameIdentity(task.refId, key, await this.storage.objectVersion(key)) !== identity) throw new Error("ตรวจเฟรม: ไฟล์เปลี่ยนระหว่างตรวจ กรุณาลองใหม่");
          const applied = await this.prisma.$transaction(async tx => {
            const locked = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "MetadataVideoJob" WHERE id=${job.id} FOR UPDATE`;
            if (locked[0]?.status !== "RUNNING") throw new Interrupted();
            const owned = await tx.metadataVideoTask.count({ where: { id: task.id, leaseToken: task.leaseToken, status: "RUNNING", leaseUntil: { gt: new Date() } } });
            if (!owned) throw new Interrupted();
            const saved = await new MetadataImportService(this.prisma).applyFrameMatch(tx, job.actorUserId, match.rowId, task.refId, { jobId: job.id, score: match.score, seconds: timeMs / 1000, panel: match.panel, objectIdentity: identity, storageKey: key });
            if (!saved) return false;
            await tx.metadataVideoMatch.deleteMany({ where: { jobId: job.id, rowId: match.rowId } });
            await tx.metadataVideoMatch.create({ data: { jobId: job.id, rowId: match.rowId, videoId: task.refId, score: match.score, seconds: timeMs / 1000, panel: match.panel, thumbnail: image!.thumbnail } });
            await tx.metadataVideoTask.update({ where: { id: task.id }, data: { error: null, dataJson: { appliedRowId: match.rowId } } });
            return true;
          }, { timeout: 20_000 });
          if (applied) {
            await this.jobs.renew(task, { status: "DONE", error: null, leaseToken: null });
            return;
          }
          if (await this.prisma.wordPressMetadataSource.count({ where: { targetVideoId: task.refId, active: true } })) {
            await this.jobs.renew(task, { status: "SKIPPED", leaseToken: null }); return;
          }
        }
      }
      if (!await this.jobs.renew(task, { status: "DONE", error: null, leaseToken: null })) throw new Interrupted();
    } finally {
      await this.prisma.metadataVideoIndex.updateMany({ where: { id: identity, leaseToken: task.leaseToken }, data: { leaseToken: null, leaseUntil: null } });
    }
  }

  private async trimCache() {
    if (Date.now() - this.lastTrim < 60_000) return;
    this.lastTrim = Date.now();
    const configured = Number(process.env.METADATA_FRAME_CACHE_LIMIT || 100000);
    const limit = Number.isFinite(configured) ? Math.max(1000, Math.min(1000000, Math.floor(configured))) : 100000;
    await this.prisma.$executeRaw`DELETE FROM "MetadataVideoFrame" WHERE id IN (SELECT id FROM "MetadataVideoFrame" WHERE "lastUsedAt"<CURRENT_TIMESTAMP-INTERVAL '30 days' ORDER BY "lastUsedAt" LIMIT 5000)`;
    const excess = await this.prisma.metadataVideoFrame.count() - limit;
    if (excess > 0) await this.prisma.$executeRaw`DELETE FROM "MetadataVideoFrame" WHERE id IN (SELECT id FROM "MetadataVideoFrame" ORDER BY "lastUsedAt" LIMIT ${Math.min(excess, 5000)})`;
  }
}
