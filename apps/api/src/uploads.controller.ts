import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type { UploadSession } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { z } from "zod";
import {
  AdminSessionGuard,
  CsrfGuard,
  type AdminRequest
} from "./admin-auth.guard";
import { PrismaService } from "./prisma.service";
import { StorageService } from "./storage.service";

const allowedExtensions = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".ts",
  ".m2ts",
  ".mts",
  ".mpg",
  ".mpeg",
  ".avi",
  ".ogv"
]);

const allowedMimeTypes: Record<string, ReadonlySet<string>> = {
  ".mp4": new Set(["video/mp4", "application/mp4"]),
  ".m4v": new Set(["video/mp4", "video/x-m4v"]),
  ".mov": new Set(["video/quicktime"]),
  ".webm": new Set(["video/webm"]),
  ".mkv": new Set(["video/x-matroska", "application/octet-stream"]),
  ".ts": new Set(["video/mp2t", "video/ts", "application/octet-stream"]),
  ".m2ts": new Set(["video/mp2t", "video/m2ts", "application/octet-stream"]),
  ".mts": new Set(["video/mp2t", "video/m2ts", "application/octet-stream"]),
  ".mpg": new Set(["video/mpeg", "application/octet-stream"]),
  ".mpeg": new Set(["video/mpeg", "application/octet-stream"]),
  ".avi": new Set(["video/x-msvideo", "video/avi", "application/octet-stream"]),
  ".ogv": new Set(["video/ogg", "application/ogg", "application/octet-stream"])
};

const preferredMimeTypes: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".ts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".mts": "video/mp2t",
  ".mpg": "video/mpeg",
  ".mpeg": "video/mpeg",
  ".avi": "video/x-msvideo",
  ".ogv": "video/ogg"
};

const initiateSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    title: z.string().trim().min(1).max(200).optional(),
    categoryId: z.string().trim().min(1).max(128).nullable().optional(),
    sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    mimeType: z.string().trim().max(120).optional().default(""),
    signatureBase64: z.string().min(4).max(2048)
  })
  .strict();

const presignSchema = z
  .object({
    partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100)
  })
  .strict();

const recordPartSchema = z
  .object({
    partNumber: z.number().int().min(1).max(10_000),
    etag: z.string().trim().min(1).max(256).regex(/^[^\r\n]+$/),
    sizeBytes: z.number().int().positive().max(1_073_741_824).optional()
  })
  .strict();

const completeSchema = z
  .object({
    parts: z
      .array(
        z.object({
          partNumber: z.number().int().min(1).max(10_000),
          etag: z.string().trim().min(1).max(256).regex(/^[^\r\n]+$/),
          sizeBytes: z.number().int().positive().max(1_073_741_824).optional()
        })
      )
      .min(1)
      .max(10_000)
  })
  .strict();

function configuredInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
) {
  const parsed = Number(process.env[name] || fallback);
  return Number.isSafeInteger(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}

function cleanFilename(value: string) {
  const normalized = value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "");
  const basename = normalized.replaceAll("\\", "/").split("/").pop()?.trim() || "";
  if (!basename || basename === "." || basename === "..") {
    throw new BadRequestException("ชื่อไฟล์ไม่ถูกต้อง");
  }
  return basename.slice(0, 255);
}

export function hasVideoSignature(extension: string, bytes: Buffer) {
  const ascii = (start: number, end: number) => bytes.subarray(start, end).toString("ascii");
  const hex = (start: number, end: number) => bytes.subarray(start, end).toString("hex");
  if ([".mp4", ".m4v", ".mov"].includes(extension)) return ascii(4, 8) === "ftyp";
  if ([".webm", ".mkv"].includes(extension)) return hex(0, 4) === "1a45dfa3";
  if (extension === ".avi") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "AVI ";
  if (extension === ".ogv") return ascii(0, 4) === "OggS";
  if ([".mpg", ".mpeg"].includes(extension)) {
    return ["000001ba", "000001b3", "000001b8"].includes(hex(0, 4));
  }
  if (extension === ".ts") {
    return bytes[0] === 0x47 && (bytes.length <= 188 || bytes[188] === 0x47);
  }
  if ([".m2ts", ".mts"].includes(extension)) {
    return bytes[4] === 0x47 && (bytes.length <= 196 || bytes[196] === 0x47);
  }
  return false;
}

function safeSignature(value: string, extension: string) {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value, "base64");
  } catch {
    throw new BadRequestException("ไม่สามารถตรวจสอบลายเซ็นไฟล์ได้");
  }
  if (bytes.length < 12 || bytes.length > 1024 || !hasVideoSignature(extension, bytes)) {
    throw new BadRequestException(
      "เนื้อหาไฟล์ไม่ตรงกับรูปแบบวิดีโอที่รองรับ หรือไฟล์อาจเสียหาย"
    );
  }
}

function safeTitle(filename: string) {
  const extension = extname(filename);
  return filename.slice(0, Math.max(1, filename.length - extension.length)).slice(0, 200);
}

function serializeSession(session: UploadSession & { parts?: Array<{ partNumber: number; etag: string }> }) {
  return {
    id: session.id,
    videoId: session.videoId,
    filename: session.originalFilename,
    mimeType: session.mimeType,
    sizeBytes: session.sizeBytes.toString(),
    partSizeBytes: session.partSizeBytes,
    expectedParts: session.expectedParts,
    status: session.status,
    expiresAt: session.expiresAt.toISOString(),
    completedAt: session.completedAt?.toISOString() || null,
    completedParts:
      session.parts?.map(part => ({ partNumber: part.partNumber, etag: part.etag })) || []
  };
}

@Controller("uploads")
@UseGuards(AdminSessionGuard, CsrfGuard)
export class UploadsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService
  ) {}

  private async ownedSession(id: string, userId: string) {
    const session = await this.prisma.uploadSession.findFirst({
      where: { id, uploadedById: userId },
      include: { parts: { orderBy: { partNumber: "asc" } } }
    });
    if (!session) throw new NotFoundException("ไม่พบเซสชันอัปโหลดนี้");
    return session;
  }

  private async expireIfNeeded(session: UploadSession) {
    if (
      session.expiresAt <= new Date() &&
      !["COMPLETED", "ABORTED", "EXPIRED"].includes(session.status)
    ) {
      await this.storage
        .abortMultipartUpload(session.storageKey, session.storageUploadId)
        .catch(() => undefined);
      await this.prisma.$transaction([
        this.prisma.uploadSession.update({
          where: { id: session.id },
          data: { status: "EXPIRED", failureReason: "UPLOAD_SESSION_EXPIRED" }
        }),
        this.prisma.video.update({
          where: { id: session.videoId },
          data: { status: "FAILED", processingError: "เซสชันอัปโหลดหมดอายุ" }
        })
      ]);
      throw new ConflictException("เซสชันอัปโหลดหมดอายุแล้ว");
    }
  }

  @Get("configuration")
  async configuration() {
    const systemConfig = await this.prisma.systemConfig.findUnique({
      where: { id: 1 },
      select: { uploadsEnabled: true, defaultCategoryId: true }
    });
    return {
      allowedExtensions: [...allowedExtensions],
      uploadsEnabled: systemConfig?.uploadsEnabled ?? true,
      defaultCategoryId: systemConfig?.defaultCategoryId || null,
      maxFileBytes: String(
        configuredInteger(
          "UPLOAD_MAX_FILE_BYTES",
          10 * 1024 ** 3,
          5 * 1024 ** 2,
          Number.MAX_SAFE_INTEGER
        )
      ),
      maxConcurrentFiles: configuredInteger(
        "UPLOAD_MAX_CONCURRENT_FILES",
        1,
        1,
        10
      ),
      maxConcurrentParts: configuredInteger(
        "UPLOAD_MAX_CONCURRENT_PARTS",
        2,
        1,
        16
      ),
      partSizeBytes: configuredInteger(
        "UPLOAD_PART_SIZE_BYTES",
        16 * 1024 ** 2,
        5 * 1024 ** 2,
        512 * 1024 ** 2
      )
    };
  }

  @Post("initiate")
  async initiate(@Req() request: AdminRequest, @Body() body: unknown) {
    const parsed = initiateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ข้อมูลไฟล์อัปโหลดไม่ถูกต้อง");
    const systemConfig = await this.prisma.systemConfig.findUnique({
      where: { id: 1 },
      select: { uploadsEnabled: true, defaultCategoryId: true }
    });
    if (systemConfig?.uploadsEnabled === false) {
      throw new ConflictException("ระบบปิดรับการอัปโหลดชั่วคราว");
    }

    const filename = cleanFilename(parsed.data.filename);
    const extension = extname(filename).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      throw new BadRequestException("นามสกุลไฟล์วิดีโอนี้ไม่รองรับ");
    }

    const declaredMime = parsed.data.mimeType.toLowerCase();
    const acceptedMimeTypes = allowedMimeTypes[extension];
    if (declaredMime && !acceptedMimeTypes?.has(declaredMime)) {
      throw new BadRequestException("ชนิด MIME ไม่ตรงกับนามสกุลไฟล์");
    }
    safeSignature(parsed.data.signatureBase64, extension);

    const maxFileBytes = configuredInteger(
      "UPLOAD_MAX_FILE_BYTES",
      10 * 1024 ** 3,
      5 * 1024 ** 2,
      Number.MAX_SAFE_INTEGER
    );
    if (parsed.data.sizeBytes > maxFileBytes) {
      throw new BadRequestException("ไฟล์มีขนาดเกินกว่าที่ระบบกำหนด");
    }

    const categoryId =
      parsed.data.categoryId === undefined || parsed.data.categoryId === null
        ? systemConfig?.defaultCategoryId || null
        : parsed.data.categoryId;
    if (categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: categoryId, active: true },
        select: { id: true }
      });
      if (!category) throw new BadRequestException("ไม่พบหมวดหมู่ที่เลือก");
    }

    const mimeType = declaredMime || preferredMimeTypes[extension] || "application/octet-stream";
    const resumable = await this.prisma.uploadSession.findFirst({
      where: {
        uploadedById: request.auth.user.id,
        originalFilename: filename,
        sizeBytes: BigInt(parsed.data.sizeBytes),
        mimeType,
        expiresAt: { gt: new Date() },
        status: { in: ["INITIATED", "UPLOADING"] }
      },
      include: { parts: { orderBy: { partNumber: "asc" } } },
      orderBy: { createdAt: "desc" }
    });
    if (resumable) return { upload: serializeSession(resumable), resumed: true };

    const partSizeBytes = configuredInteger(
      "UPLOAD_PART_SIZE_BYTES",
      16 * 1024 ** 2,
      5 * 1024 ** 2,
      512 * 1024 ** 2
    );
    const expectedParts = Math.ceil(parsed.data.sizeBytes / partSizeBytes);
    if (expectedParts > 10_000) {
      throw new BadRequestException("ไฟล์นี้ต้องแบ่งเป็นจำนวนส่วนมากเกินไป");
    }

    const video = await this.prisma.video.create({
      data: {
        title: parsed.data.title || safeTitle(filename),
        originalFilename: filename,
        fileSize: BigInt(parsed.data.sizeBytes),
        mimeType,
        status: "UPLOADING",
        uploadedById: request.auth.user.id,
        categoryId
      }
    });
    const fileId = randomUUID();
    const storageKey = `videos/${video.id}/original/${fileId}${extension}`;
    let storageUploadId: string;
    try {
      storageUploadId = await this.storage.createMultipartUpload(storageKey, mimeType);
    } catch (error) {
      await this.prisma.video.delete({ where: { id: video.id } });
      throw error;
    }

    try {
      const ttlSeconds = configuredInteger(
        "UPLOAD_SESSION_TTL_SECONDS",
        86_400,
        900,
        604_800
      );
      const session = await this.prisma.uploadSession.create({
        data: {
          videoId: video.id,
          uploadedById: request.auth.user.id,
          fileId,
          storageUploadId,
          storageKey,
          originalFilename: filename,
          extension,
          mimeType,
          sizeBytes: BigInt(parsed.data.sizeBytes),
          partSizeBytes,
          expectedParts,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000)
        },
        include: { parts: true }
      });
      await this.prisma.auditLog.create({
        data: {
          actorUserId: request.auth.user.id,
          action: "VIDEO_UPLOAD_STARTED",
          entityType: "Video",
          entityId: video.id,
          metadataJson: {
            uploadSessionId: session.id,
            filename,
            sizeBytes: String(parsed.data.sizeBytes)
          },
          userAgent: request.headers["user-agent"]?.slice(0, 512)
        }
      });
      return { upload: serializeSession(session), resumed: false };
    } catch (error) {
      await this.storage
        .abortMultipartUpload(storageKey, storageUploadId)
        .catch(() => undefined);
      await this.prisma.video.delete({ where: { id: video.id } });
      throw error;
    }
  }

  @Post(":id/parts/presign")
  async presign(
    @Req() request: AdminRequest,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    const parsed = presignSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("รายการส่วนอัปโหลดไม่ถูกต้อง");
    const session = await this.ownedSession(id, request.auth.user.id);
    await this.expireIfNeeded(session);
    if (!["INITIATED", "UPLOADING"].includes(session.status)) {
      throw new ConflictException("เซสชันนี้ไม่สามารถรับไฟล์เพิ่มได้");
    }
    const uniquePartNumbers = [...new Set(parsed.data.partNumbers)];
    if (
      uniquePartNumbers.length !== parsed.data.partNumbers.length ||
      uniquePartNumbers.some(number => number > session.expectedParts)
    ) {
      throw new BadRequestException("หมายเลขส่วนอัปโหลดไม่ถูกต้อง");
    }

    const expiry = configuredInteger("UPLOAD_URL_TTL_SECONDS", 3600, 60, 3600);
    const parts = await Promise.all(
      uniquePartNumbers.map(async partNumber => ({
        partNumber,
        url: await this.storage.presignPart(
          session.storageKey,
          session.storageUploadId,
          partNumber,
          expiry
        ),
        expiresIn: expiry
      }))
    );
    if (session.status === "INITIATED") {
      await this.prisma.uploadSession.update({
        where: { id: session.id },
        data: { status: "UPLOADING", failureReason: null }
      });
    }
    return { parts };
  }

  @Post(":id/parts/record")
  async recordPart(
    @Req() request: AdminRequest,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    const parsed = recordPartSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ข้อมูลส่วนอัปโหลดไม่ถูกต้อง");
    const session = await this.ownedSession(id, request.auth.user.id);
    await this.expireIfNeeded(session);
    if (!["INITIATED", "UPLOADING"].includes(session.status)) {
      throw new ConflictException("เซสชันนี้ไม่สามารถบันทึกส่วนอัปโหลดได้");
    }
    if (parsed.data.partNumber > session.expectedParts) {
      throw new BadRequestException("หมายเลขส่วนอัปโหลดไม่ถูกต้อง");
    }
    await this.prisma.uploadPart.upsert({
      where: {
        uploadSessionId_partNumber: {
          uploadSessionId: session.id,
          partNumber: parsed.data.partNumber
        }
      },
      create: {
        uploadSessionId: session.id,
        partNumber: parsed.data.partNumber,
        etag: parsed.data.etag,
        sizeBytes: parsed.data.sizeBytes
      },
      update: {
        etag: parsed.data.etag,
        sizeBytes: parsed.data.sizeBytes
      }
    });
    return { recorded: true };
  }

  @Post(":id/complete")
  async complete(
    @Req() request: AdminRequest,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ข้อมูลยืนยันการอัปโหลดไม่ถูกต้อง");
    const session = await this.ownedSession(id, request.auth.user.id);
    if (session.status === "COMPLETED") {
      return { completed: true, idempotent: true, videoId: session.videoId };
    }
    await this.expireIfNeeded(session);

    const sortedParts = parsed.data.parts
      .slice()
      .sort((left, right) => left.partNumber - right.partNumber);
    const validSequence =
      sortedParts.length === session.expectedParts &&
      sortedParts.every((part, index) => part.partNumber === index + 1);
    if (!validSequence) {
      throw new BadRequestException("รายการส่วนอัปโหลดไม่ครบหรือเรียงลำดับไม่ถูกต้อง");
    }

    const claimed = await this.prisma.uploadSession.updateMany({
      where: {
        id: session.id,
        status: { in: ["INITIATED", "UPLOADING", "FAILED"] }
      },
      data: { status: "COMPLETING", failureReason: null }
    });
    if (claimed.count === 0 && session.status !== "COMPLETING") {
      throw new ConflictException("เซสชันอัปโหลดอยู่ในสถานะที่ไม่สามารถยืนยันได้");
    }

    let object = await this.storage.headObject(session.storageKey);
    if (!object.exists) {
      try {
        await this.storage.completeMultipartUpload(
          session.storageKey,
          session.storageUploadId,
          sortedParts
        );
        object = await this.storage.headObject(session.storageKey);
      } catch (error) {
        object = await this.storage.headObject(session.storageKey).catch(() => ({
          exists: false as const,
          sizeBytes: 0,
          contentType: null
        }));
        if (!object.exists) {
          await this.prisma.uploadSession.update({
            where: { id: session.id },
            data: {
              status: "FAILED",
              failureReason:
                error instanceof Error ? error.name.slice(0, 120) : "UPLOAD_COMPLETE_FAILED"
            }
          });
          throw new ConflictException("ไม่สามารถยืนยันการอัปโหลดกับพื้นที่จัดเก็บได้");
        }
      }
    }
    if (object.sizeBytes !== Number(session.sizeBytes)) {
      await this.prisma.uploadSession.update({
        where: { id: session.id },
        data: { status: "FAILED", failureReason: "OBJECT_SIZE_MISMATCH" }
      });
      throw new ConflictException("ขนาดไฟล์ที่จัดเก็บไม่ตรงกับไฟล์ต้นฉบับ");
    }

    const completedAt = new Date();
    await this.prisma.$transaction(async transaction => {
      for (const part of sortedParts) {
        await transaction.uploadPart.upsert({
          where: {
            uploadSessionId_partNumber: {
              uploadSessionId: session.id,
              partNumber: part.partNumber
            }
          },
          create: {
            uploadSessionId: session.id,
            partNumber: part.partNumber,
            etag: part.etag,
            sizeBytes: part.sizeBytes
          },
          update: { etag: part.etag, sizeBytes: part.sizeBytes }
        });
      }
      await transaction.videoFile.upsert({
        where: { id: session.fileId },
        create: {
          id: session.fileId,
          videoId: session.videoId,
          role: "ORIGINAL",
          storageKey: session.storageKey,
          filename: session.originalFilename,
          extension: session.extension,
          mimeType: session.mimeType,
          sizeBytes: session.sizeBytes
        },
        update: {
          mimeType: session.mimeType,
          sizeBytes: session.sizeBytes
        }
      });
      await transaction.uploadSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED", completedAt, failureReason: null }
      });
      await transaction.video.update({
        where: { id: session.videoId },
        data: {
          status: "UPLOADED",
          originalKey: session.storageKey,
          fileSize: session.sizeBytes,
          uploadedAt: completedAt,
          processingError: null
        }
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: request.auth.user.id,
          action: "VIDEO_UPLOAD_COMPLETED",
          entityType: "Video",
          entityId: session.videoId,
          metadataJson: {
            uploadSessionId: session.id,
            sizeBytes: session.sizeBytes.toString(),
            partCount: sortedParts.length
          },
          userAgent: request.headers["user-agent"]?.slice(0, 512)
        }
      });
    });

    return { completed: true, idempotent: false, videoId: session.videoId };
  }

  @Post(":id/abort")
  async abort(@Req() request: AdminRequest, @Param("id") id: string) {
    const session = await this.ownedSession(id, request.auth.user.id);
    if (session.status === "ABORTED") return { aborted: true, idempotent: true };
    if (session.status === "COMPLETED") {
      throw new ConflictException("ไฟล์นี้อัปโหลดเสร็จแล้วและไม่สามารถยกเลิกได้");
    }
    await this.storage.abortMultipartUpload(
      session.storageKey,
      session.storageUploadId
    );
    await this.prisma.$transaction([
      this.prisma.uploadSession.update({
        where: { id: session.id },
        data: { status: "ABORTED", failureReason: null }
      }),
      this.prisma.video.update({
        where: { id: session.videoId },
        data: { status: "FAILED", processingError: "ผู้ใช้งานยกเลิกการอัปโหลด" }
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: request.auth.user.id,
          action: "VIDEO_UPLOAD_ABORTED",
          entityType: "Video",
          entityId: session.videoId,
          metadataJson: { uploadSessionId: session.id },
          userAgent: request.headers["user-agent"]?.slice(0, 512)
        }
      })
    ]);
    return { aborted: true, idempotent: false };
  }

  @Get(":id")
  async getStatus(@Req() request: AdminRequest, @Param("id") id: string) {
    const session = await this.ownedSession(id, request.auth.user.id);
    await this.expireIfNeeded(session);
    return { upload: serializeSession(session) };
  }
}
