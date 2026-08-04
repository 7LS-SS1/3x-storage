import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
  UseGuards
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import { VideoStatus } from "@prisma/client";
import { z } from "zod";
import {
  AdminSessionGuard,
  canManageAllVideos,
  CsrfGuard,
  type AdminRequest
} from "./admin-auth.guard";
import { PrismaService } from "./prisma.service";
import { StorageService } from "./storage.service";
import { uploadedPosterStorageKey } from "./poster-storage";

const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().refine(value => [10, 20, 30, 50, 100].includes(value)).default(20),
    search: z.string().trim().max(120).optional(),
    categoryId: z.string().trim().max(128).optional(),
    status: z.nativeEnum(VideoStatus).optional(),
    sort: z
      .enum([
        "newest",
        "oldest",
        "title_asc",
        "title_desc",
        "duration_asc",
        "duration_desc",
        "plays_desc"
      ])
      .default("newest")
  })
  .strict();

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    categoryId: z.string().trim().min(1).max(128).nullable().optional(),
    allowedDomainIds: z
      .array(z.string().trim().min(1).max(128))
      .max(100)
      .optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0);

const bulkCategorySchema = z
  .object({
    videoIds: z.array(z.string().min(1).max(128)).min(1).max(100),
    categoryId: z.string().trim().min(1).max(128).nullable()
  })
  .strict();

const bulkDeleteSchema = z
  .object({
    videoIds: z.array(z.string().min(1).max(128)).min(1).max(100)
  })
  .strict();

const orderByMap = {
  newest: { createdAt: "desc" },
  oldest: { createdAt: "asc" },
  title_asc: { title: "asc" },
  title_desc: { title: "desc" },
  duration_asc: { durationSeconds: "asc" },
  duration_desc: { durationSeconds: "desc" },
  plays_desc: { playCount: "desc" }
} as const;

type VideoListItem = {
  id: string;
  publicId: string;
  title: string;
  status: VideoStatus;
  durationSeconds: number | null;
  playCount: bigint;
  fileSize: bigint | null;
  mimeType: string | null;
  originalFilename: string | null;
  uploadedAt: Date | null;
  createdAt: Date;
  processingError: string | null;
  posterKey: string | null;
  category: { id: string; name: string } | null;
  allowedDomains: Array<{
    allowedDomain: { id: string; hostname: string; includeSubdomains: boolean };
  }>;
  uploadedBy: { id: string; name: string; email: string };
  files: Array<{ id: string; role: string; mimeType: string }>;
};

function playerBaseUrl() {
  const configured = process.env.PLAYER_URL || process.env.ADMIN_URL;
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

function serializeVideo(video: VideoListItem, posterUrl: string | null = null) {
  const player = playerBaseUrl();
  return {
    id: video.id,
    publicId: video.publicId,
    title: video.title,
    category: video.category,
    allowedDomains: video.allowedDomains.map(item => item.allowedDomain),
    status: video.status,
    durationSeconds: video.durationSeconds,
    playCount: video.playCount.toString(),
    fileSizeBytes: video.fileSize?.toString() || null,
    mimeType: video.mimeType,
    originalFilename: video.originalFilename,
    uploadedAt: (video.uploadedAt || video.createdAt).toISOString(),
    uploadedBy: video.uploadedBy,
    processingError: video.processingError,
    posterAvailable: Boolean(video.posterKey),
    posterUrl,
    previewAvailable: video.files.some(file =>
      ["HLS_MANIFEST", "PLAYBACK", "ORIGINAL"].includes(file.role)
    ),
    embedUrl: player ? `${player}/embed/${video.publicId}` : null
  };
}

@Controller("videos")
@UseGuards(AdminSessionGuard, CsrfGuard)
export class VideosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService
  ) {}

  private async assertCategory(categoryId: string | null | undefined) {
    if (!categoryId) return;
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, active: true },
      select: { id: true }
    });
    if (!category) throw new BadRequestException("ไม่พบหมวดหมู่ที่เลือก");
  }

  private async deleteOne(videoId: string, actor: AdminRequest["auth"]["user"]) {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, deletedAt: null },
      include: {
        files: { select: { storageKey: true } },
        uploadSessions: {
          where: { status: { in: ["INITIATED", "UPLOADING", "COMPLETING", "FAILED"] } },
          select: { id: true, storageKey: true, storageUploadId: true }
        }
      }
    });
    if (!video) return { id: videoId, success: false, error: "ไม่พบวิดีโอ" };

    await this.prisma.$transaction([
      this.prisma.video.update({
        where: { id: video.id },
        data: { status: "DELETING", processingError: null }
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: "VIDEO_DELETE_STARTED",
          entityType: "Video",
          entityId: video.id,
          metadataJson: { fileCount: video.files.length }
        }
      })
    ]);

    try {
      for (const upload of video.uploadSessions) {
        await this.storage
          .abortMultipartUpload(upload.storageKey, upload.storageUploadId)
          .catch(() => undefined);
      }
      const uniqueStorageKeys = [...new Set([
        ...video.files.map(file => file.storageKey),
        ...(video.posterKey ? [video.posterKey] : [])
      ])];
      for (let offset = 0; offset < uniqueStorageKeys.length; offset += 5) {
        await Promise.all(
          uniqueStorageKeys
            .slice(offset, offset + 5)
            .map(storageKey => this.storage.deleteObject(storageKey))
        );
      }
      const deletedAt = new Date();
      await this.prisma.$transaction([
        this.prisma.uploadSession.updateMany({
          where: { videoId: video.id, status: { not: "COMPLETED" } },
          data: { status: "ABORTED", failureReason: "VIDEO_DELETED" }
        }),
        this.prisma.video.update({
          where: { id: video.id },
          data: { status: "DELETED", deletedAt, processingError: null }
        }),
        this.prisma.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: "VIDEO_DELETED",
            entityType: "Video",
            entityId: video.id,
            metadataJson: { deletedObjectCount: uniqueStorageKeys.length }
          }
        })
      ]);
      return { id: videoId, success: true };
    } catch {
      await this.prisma.video.update({
        where: { id: video.id },
        data: {
          status: "FAILED",
          processingError: "ไม่สามารถลบไฟล์ทั้งหมดจากพื้นที่จัดเก็บได้"
        }
      });
      return {
        id: videoId,
        success: false,
        error: "ไม่สามารถลบไฟล์จากพื้นที่จัดเก็บได้"
      };
    }
  }

  @Get()
  async list(@Query() query: Record<string, unknown>) {
    const parsed = listSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("ตัวกรองรายการวิดีโอไม่ถูกต้อง");
    const { page, pageSize, search, categoryId, status, sort } = parsed.data;
    const where = {
      deletedAt: null,
      ...(search
        ? { title: { contains: search, mode: "insensitive" as const } }
        : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(status ? { status } : {})
    };
    const [total, videos] = await this.prisma.$transaction([
      this.prisma.video.count({ where }),
      this.prisma.video.findMany({
        where,
        orderBy: orderByMap[sort],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          publicId: true,
          title: true,
          status: true,
          durationSeconds: true,
          playCount: true,
          fileSize: true,
          mimeType: true,
          originalFilename: true,
          uploadedAt: true,
          createdAt: true,
          processingError: true,
          posterKey: true,
          category: { select: { id: true, name: true } },
          allowedDomains: {
            select: {
              allowedDomain: {
                select: { id: true, hostname: true, includeSubdomains: true }
              }
            }
          },
          uploadedBy: { select: { id: true, name: true, email: true } },
          files: { select: { id: true, role: true, mimeType: true } }
        }
      })
    ]);
    const data = await Promise.all(videos.map(async video =>
      serializeVideo(
        video,
        video.posterKey
          ? await this.storage.createReadUrl(video.posterKey, 600)
          : null
      )
    ));
    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      }
    };
  }

  @Get(":id")
  async detail(@Param("id") id: string) {
    const video = await this.prisma.video.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        publicId: true,
        title: true,
        status: true,
        durationSeconds: true,
        playCount: true,
        fileSize: true,
        mimeType: true,
        originalFilename: true,
        uploadedAt: true,
        createdAt: true,
        processingError: true,
        posterKey: true,
        category: { select: { id: true, name: true } },
        allowedDomains: {
          select: {
            allowedDomain: {
              select: { id: true, hostname: true, includeSubdomains: true }
            }
          }
        },
        uploadedBy: { select: { id: true, name: true, email: true } },
        files: { select: { id: true, role: true, mimeType: true } }
      }
    });
    if (!video) throw new NotFoundException("ไม่พบวิดีโอ");
    return {
      video: serializeVideo(
        video,
        video.posterKey
          ? await this.storage.createReadUrl(video.posterKey, 600)
          : null
      )
    };
  }

  @Patch(":id")
  async update(
    @Req() request: AdminRequest,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ข้อมูลแก้ไขวิดีโอไม่ถูกต้อง");
    await this.assertCategory(parsed.data.categoryId);
    const allowedDomainIds = parsed.data.allowedDomainIds
      ? [...new Set(parsed.data.allowedDomainIds)]
      : undefined;
    if (allowedDomainIds !== undefined) {
      if (!canManageAllVideos(request.auth.user.role)) {
        throw new ConflictException("บัญชี STAFF ไม่มีสิทธิ์กำหนดโดเมนให้วิดีโอ");
      }
      const activeDomainCount = await this.prisma.allowedDomain.count({
        where: { id: { in: allowedDomainIds }, active: true }
      });
      if (activeDomainCount !== allowedDomainIds.length) {
        throw new BadRequestException("รายการโดเมนที่เลือกไม่ถูกต้องหรือถูกปิดใช้งาน");
      }
    }
    const existing = await this.prisma.video.findFirst({
      where: { id, deletedAt: null },
      select: { id: true }
    });
    if (!existing) throw new NotFoundException("ไม่พบวิดีโอ");
    const video = await this.prisma.$transaction(async transaction => {
      const updated = await transaction.video.update({
        where: { id },
        data: {
          ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
          ...(parsed.data.categoryId !== undefined
            ? { categoryId: parsed.data.categoryId }
            : {})
        },
        select: { id: true, title: true, categoryId: true, updatedAt: true }
      });
      if (allowedDomainIds !== undefined) {
        await transaction.videoAllowedDomain.deleteMany({ where: { videoId: id } });
        if (allowedDomainIds.length) {
          await transaction.videoAllowedDomain.createMany({
            data: allowedDomainIds.map(allowedDomainId => ({
              videoId: id,
              allowedDomainId
            }))
          });
        }
      }
      await transaction.auditLog.create({
        data: {
          actorUserId: request.auth.user.id,
          action: "VIDEO_UPDATED",
          entityType: "Video",
          entityId: id,
          metadataJson: {
            fields: Object.keys(parsed.data)
          },
          userAgent: request.headers["user-agent"]?.slice(0, 512)
        }
      });
      return updated;
    });
    return { video };
  }

  @Post(":id/poster")
  @UseInterceptors(FileInterceptor("poster", { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }))
  async updatePoster(
    @Req() request: AdminRequest,
    @Param("id") id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined
  ) {
    if (!file?.buffer?.length) throw new BadRequestException("กรุณาเลือกรูปหน้าปก");
    const signatures = [
      { type: "image/jpeg", ext: "jpg", valid: file.buffer[0] === 0xff && file.buffer[1] === 0xd8 },
      { type: "image/png", ext: "png", valid: file.buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
      { type: "image/webp", ext: "webp", valid: file.buffer.subarray(0, 4).toString() === "RIFF" && file.buffer.subarray(8, 12).toString() === "WEBP" }
    ];
    const image = signatures.find(item => item.type === file.mimetype && item.valid);
    if (!image) throw new BadRequestException("รองรับรูป JPG, PNG หรือ WebP เท่านั้น");
    const existing = await this.prisma.video.findFirst({ where: { id, deletedAt: null }, select: { id: true, posterKey: true } });
    if (!existing) throw new NotFoundException("ไม่พบวิดีโอ");
    const posterKey = uploadedPosterStorageKey(id, randomUUID(), image.ext);
    await this.storage.putObject(posterKey, file.buffer, image.type);
    try {
      await this.prisma.$transaction([
        this.prisma.video.update({ where: { id }, data: { posterKey } }),
        this.prisma.auditLog.create({ data: { actorUserId: request.auth.user.id, action: "VIDEO_POSTER_UPDATED", entityType: "Video", entityId: id, metadataJson: { mimeType: image.type, sizeBytes: file.size }, userAgent: request.headers["user-agent"]?.slice(0, 512) } })
      ]);
    } catch (error) {
      await this.storage.deleteObject(posterKey).catch(() => undefined);
      throw error;
    }
    if (existing.posterKey) await this.storage.deleteObject(existing.posterKey).catch(() => undefined);
    return { updated: true };
  }

  @Delete(":id")
  async remove(@Req() request: AdminRequest, @Param("id") id: string) {
    const result = await this.deleteOne(id, request.auth.user);
    if (!result.success) throw new ConflictException(result.error);
    return { deleted: true };
  }

  @Post("bulk/category")
  async bulkCategory(@Req() request: AdminRequest, @Body() body: unknown) {
    const parsed = bulkCategorySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ข้อมูลแก้ไขหมวดหมู่ไม่ถูกต้อง");
    const videoIds = [...new Set(parsed.data.videoIds)];
    await this.assertCategory(parsed.data.categoryId);
    const result = await this.prisma.$transaction(async transaction => {
      const updated = await transaction.video.updateMany({
        where: { id: { in: videoIds }, deletedAt: null },
        data: { categoryId: parsed.data.categoryId }
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: request.auth.user.id,
          action: "VIDEO_BULK_CATEGORY_UPDATED",
          entityType: "Video",
          metadataJson: {
            requestedCount: videoIds.length,
            updatedCount: updated.count,
            categoryId: parsed.data.categoryId
          },
          userAgent: request.headers["user-agent"]?.slice(0, 512)
        }
      });
      return updated;
    });
    return {
      requestedCount: videoIds.length,
      successCount: result.count,
      failureCount: videoIds.length - result.count
    };
  }

  @Post("bulk/delete")
  async bulkDelete(@Req() request: AdminRequest, @Body() body: unknown) {
    const parsed = bulkDeleteSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("รายการวิดีโอที่ต้องการลบไม่ถูกต้อง");
    const videoIds = [...new Set(parsed.data.videoIds)];
    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    for (let offset = 0; offset < videoIds.length; offset += 5) {
      results.push(
        ...(await Promise.all(
          videoIds
            .slice(offset, offset + 5)
            .map(videoId => this.deleteOne(videoId, request.auth.user))
        ))
      );
    }
    return {
      requestedCount: videoIds.length,
      successCount: results.filter(result => result.success).length,
      failureCount: results.filter(result => !result.success).length,
      failures: results.filter(result => !result.success)
    };
  }

  @Post(":id/admin-preview-token")
  async preview(@Param("id") id: string) {
    const video = await this.prisma.video.findFirst({
      where: {
        id,
        deletedAt: null,
        status: { notIn: ["DELETING", "DELETED", "FAILED"] }
      },
      select: {
        id: true,
        title: true,
        posterKey: true,
        files: {
          where: { role: { in: ["HLS_MANIFEST", "PLAYBACK", "ORIGINAL"] } },
          orderBy: { createdAt: "desc" },
          select: { id: true, role: true, storageKey: true, mimeType: true },
          take: 5
        }
      }
    });
    if (!video) throw new NotFoundException("ไม่พบวิดีโอ");
    const file =
      video.files.find(item => item.role === "HLS_MANIFEST") ||
      video.files.find(item => item.role === "PLAYBACK") ||
      video.files.find(item => item.role === "ORIGINAL");
    if (!file) throw new ConflictException("วิดีโอยังไม่มีไฟล์สำหรับแสดงตัวอย่าง");
    const expiresIn = 300;
    return {
      preview: {
        title: video.title,
        mimeType: file.mimeType,
        url: await this.storage.createReadUrl(file.storageKey, expiresIn),
        posterUrl: video.posterKey
          ? await this.storage.createReadUrl(video.posterKey, expiresIn)
          : null,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
      }
    };
  }
}
