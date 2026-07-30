import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import type {
  ExternalImportStatus,
  GoogleDriveImport
} from "@prisma/client";
import {
  createHash,
  randomBytes,
  randomUUID
} from "node:crypto";
import { extname } from "node:path";
import { DriveImportQueueService } from "./drive-import-queue.service";
import {
  decryptGoogleSecret,
  encryptGoogleSecret
} from "./google-drive-crypto";
import { PrismaService } from "./prisma.service";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_SCOPES = ["openid", "email", DRIVE_SCOPE];
const ACTIVE_IMPORT_STATUSES: ExternalImportStatus[] = [
  "QUEUED",
  "VALIDATING",
  "TRANSFERRING",
  "COMPLETING"
];
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

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type GoogleUserInfo = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
};

type GoogleFileMetadata = {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  headRevisionId?: string;
  trashed?: boolean;
  capabilities?: { canDownload?: boolean };
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function base64UrlSha256(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function cleanFilename(value: string) {
  const normalized = value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "");
  const basename = normalized.replaceAll("\\", "/").split("/").pop()?.trim() || "";
  if (!basename || basename === "." || basename === "..") {
    throw new BadRequestException("ชื่อไฟล์จาก Google Drive ไม่ถูกต้อง");
  }
  return basename.slice(0, 255);
}

function titleFromFilename(filename: string) {
  const extension = extname(filename);
  return filename
    .slice(0, Math.max(1, filename.length - extension.length))
    .slice(0, 200);
}

function maxFileBytes() {
  const configured = process.env.UPLOAD_MAX_FILE_BYTES || String(10 * 1024 ** 3);
  try {
    return BigInt(configured);
  } catch {
    return BigInt(10 * 1024 ** 3);
  }
}

function redirectUri() {
  const configured = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured;
  const adminOrigin = new URL(process.env.ADMIN_URL || "http://localhost:3000").origin;
  return `${adminOrigin}/backend/google-drive/callback`;
}

function requiredGoogleConfiguration() {
  const values = {
    clientId: process.env.GOOGLE_CLIENT_ID?.trim(),
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim(),
    pickerApiKey: process.env.GOOGLE_PICKER_API_KEY?.trim(),
    projectNumber: process.env.GOOGLE_CLOUD_PROJECT_NUMBER?.trim(),
    encryptionKey: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim()
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value || value.startsWith("replace-with"))
    .map(([name]) => name);
  if (
    values.encryptionKey &&
    !values.encryptionKey.startsWith("replace-with") &&
    !/^[a-f0-9]{64}$/i.test(values.encryptionKey)
  ) {
    missing.push("encryptionKey");
  }
  if (missing.length) {
    throw new ServiceUnavailableException(
      "ยังไม่ได้ตั้งค่าการเชื่อมต่อ Google Drive ให้ครบถ้วน"
    );
  }
  return {
    clientId: values.clientId!,
    clientSecret: values.clientSecret!,
    pickerApiKey: values.pickerApiKey!,
    projectNumber: values.projectNumber!,
    redirectUri: redirectUri()
  };
}

function configuredStatus() {
  const settings = [
    ["GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID],
    ["GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET],
    ["GOOGLE_PICKER_API_KEY", process.env.GOOGLE_PICKER_API_KEY],
    ["GOOGLE_CLOUD_PROJECT_NUMBER", process.env.GOOGLE_CLOUD_PROJECT_NUMBER],
    ["GOOGLE_TOKEN_ENCRYPTION_KEY", process.env.GOOGLE_TOKEN_ENCRYPTION_KEY]
  ] as const;
  const missingSettings = settings
    .filter(([, value]) => !value?.trim() || value.startsWith("replace-with"))
    .map(([name]) => name);
  if (
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY &&
    !/^[a-f0-9]{64}$/i.test(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY)
  ) {
    if (!missingSettings.includes("GOOGLE_TOKEN_ENCRYPTION_KEY")) {
      missingSettings.push("GOOGLE_TOKEN_ENCRYPTION_KEY");
    }
  }
  return { configured: missingSettings.length === 0, missingSettings };
}

function serializeImport(value: GoogleDriveImport) {
  return {
    id: value.id,
    googleFileId: value.googleFileId,
    filename: value.filename,
    title: value.title,
    mimeType: value.mimeType,
    sizeBytes: value.sizeBytes.toString(),
    status: value.status,
    progress: value.progress,
    transferredBytes: value.transferredBytes.toString(),
    videoId: value.videoId,
    errorMessage: value.errorMessage,
    attempts: value.attempts,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    completedAt: value.completedAt?.toISOString() || null
  };
}

@Injectable()
export class GoogleDriveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: DriveImportQueueService
  ) {}

  async status(userId: string) {
    const configuration = configuredStatus();
    const connection = await this.prisma.googleDriveConnection.findUnique({
      where: { userId },
      select: { email: true, updatedAt: true }
    });
    return {
      ...configuration,
      connected: Boolean(connection),
      connection: connection
        ? {
            email: connection.email,
            updatedAt: connection.updatedAt.toISOString()
          }
        : null
    };
  }

  async authorizationUrl(userId: string) {
    const config = requiredGoogleConfiguration();
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    await this.prisma.$transaction([
      this.prisma.externalOAuthState.deleteMany({
        where: {
          userId,
          provider: "GOOGLE_DRIVE",
          OR: [{ expiresAt: { lte: new Date() } }, { usedAt: { not: null } }]
        }
      }),
      this.prisma.externalOAuthState.create({
        data: {
          provider: "GOOGLE_DRIVE",
          stateHash: sha256(state),
          codeVerifierEncrypted: encryptGoogleSecret(verifier),
          userId,
          expiresAt: new Date(Date.now() + 10 * 60_000)
        }
      })
    ]);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent select_account",
      state,
      code_challenge: base64UrlSha256(verifier),
      code_challenge_method: "S256"
    }).toString();
    return url.toString();
  }

  private async tokenRequest(parameters: Record<string, string>) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams(parameters),
      signal: AbortSignal.timeout(20_000)
    });
    const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new ServiceUnavailableException(
        "Google ไม่สามารถยืนยันการเชื่อมต่อได้ กรุณาลองใหม่"
      );
    }
    return payload;
  }

  async completeAuthorization(userId: string, code: string, state: string) {
    const config = requiredGoogleConfiguration();
    const oauthState = await this.prisma.externalOAuthState.findUnique({
      where: { stateHash: sha256(state) }
    });
    if (
      !oauthState ||
      oauthState.userId !== userId ||
      oauthState.provider !== "GOOGLE_DRIVE" ||
      oauthState.usedAt ||
      oauthState.expiresAt <= new Date()
    ) {
      throw new BadRequestException(
        "คำขอเชื่อมต่อ Google Drive หมดอายุหรือไม่ถูกต้อง"
      );
    }
    const claimed = await this.prisma.externalOAuthState.updateMany({
      where: { id: oauthState.id, usedAt: null },
      data: { usedAt: new Date() }
    });
    if (claimed.count !== 1) {
      throw new BadRequestException("คำขอเชื่อมต่อนี้ถูกใช้งานแล้ว");
    }
    const verifier = decryptGoogleSecret(oauthState.codeVerifierEncrypted);
    const token = await this.tokenRequest({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri
    });
    const userInfoResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(15_000)
      }
    );
    const userInfo = (await userInfoResponse
      .json()
      .catch(() => ({}))) as GoogleUserInfo;
    if (
      !userInfoResponse.ok ||
      !userInfo.sub ||
      !userInfo.email ||
      userInfo.email_verified === false
    ) {
      throw new ServiceUnavailableException(
        "ไม่สามารถตรวจสอบบัญชี Google ที่เชื่อมต่อได้"
      );
    }
    const existing = await this.prisma.googleDriveConnection.findUnique({
      where: { userId }
    });
    const refreshTokenEncrypted = token.refresh_token
      ? encryptGoogleSecret(token.refresh_token)
      : existing?.refreshTokenEncrypted;
    if (!refreshTokenEncrypted) {
      throw new ConflictException(
        "Google ไม่ได้ส่ง refresh token กรุณาถอดสิทธิ์แอปจากบัญชี Google แล้วเชื่อมต่อใหม่"
      );
    }
    const scopes = (token.scope || GOOGLE_SCOPES.join(" "))
      .split(/\s+/)
      .filter(Boolean);
    if (!scopes.includes(DRIVE_SCOPE)) {
      throw new BadRequestException("บัญชี Google ไม่ได้อนุญาตให้อ่านไฟล์ที่เลือก");
    }
    await this.prisma.$transaction([
      this.prisma.googleDriveConnection.upsert({
        where: { userId },
        create: {
          userId,
          googleUserId: userInfo.sub,
          email: userInfo.email.toLowerCase(),
          refreshTokenEncrypted,
          grantedScopes: scopes
        },
        update: {
          googleUserId: userInfo.sub,
          email: userInfo.email.toLowerCase(),
          refreshTokenEncrypted,
          grantedScopes: scopes
        }
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: "GOOGLE_DRIVE_CONNECTED",
          entityType: "GoogleDriveConnection",
          metadataJson: { email: userInfo.email.toLowerCase() }
        }
      })
    ]);
  }

  async accessToken(userId: string) {
    const config = requiredGoogleConfiguration();
    const connection = await this.prisma.googleDriveConnection.findUnique({
      where: { userId }
    });
    if (!connection) {
      throw new NotFoundException("ยังไม่ได้เชื่อมต่อบัญชี Google Drive");
    }
    const token = await this.tokenRequest({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: decryptGoogleSecret(connection.refreshTokenEncrypted),
      grant_type: "refresh_token"
    });
    return {
      connection,
      accessToken: token.access_token!,
      expiresIn: Math.min(Math.max(token.expires_in || 3600, 60), 3600)
    };
  }

  async pickerToken(userId: string) {
    const config = requiredGoogleConfiguration();
    const token = await this.accessToken(userId);
    return {
      accessToken: token.accessToken,
      expiresIn: token.expiresIn,
      apiKey: config.pickerApiKey,
      appId: config.projectNumber
    };
  }

  private async fileMetadata(accessToken: string, fileId: string) {
    const url = new URL(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`
    );
    url.searchParams.set(
      "fields",
      "id,name,mimeType,size,md5Checksum,modifiedTime,headRevisionId,trashed,capabilities(canDownload)"
    );
    url.searchParams.set("supportsAllDrives", "true");
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(20_000)
    });
    const value = (await response.json().catch(() => ({}))) as GoogleFileMetadata;
    if (!response.ok) {
      throw new BadRequestException(
        "ไม่สามารถอ่านข้อมูลไฟล์ที่เลือกจาก Google Drive ได้"
      );
    }
    return value;
  }

  private validateMetadata(value: GoogleFileMetadata) {
    if (
      !value.id ||
      !value.name ||
      !value.mimeType ||
      !value.size ||
      value.trashed ||
      value.capabilities?.canDownload !== true
    ) {
      throw new BadRequestException(
        "ไฟล์ Google Drive นี้ไม่มีสิทธิ์ดาวน์โหลดหรือไม่ใช่ไฟล์วิดีโอแบบไบนารี"
      );
    }
    const filename = cleanFilename(value.name);
    const extension = extname(filename).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      throw new BadRequestException(`ไม่รองรับรูปแบบไฟล์ ${filename}`);
    }
    const allowedMimes = allowedMimeTypes[extension];
    if (!allowedMimes?.has(value.mimeType)) {
      throw new BadRequestException(
        `ชนิด MIME ของ ${filename} ไม่ตรงกับนามสกุลไฟล์`
      );
    }
    let sizeBytes: bigint;
    try {
      sizeBytes = BigInt(value.size);
    } catch {
      throw new BadRequestException(`ขนาดของ ${filename} ไม่ถูกต้อง`);
    }
    if (sizeBytes <= 0 || sizeBytes > maxFileBytes()) {
      throw new BadRequestException(
        `${filename} มีขนาดเกินข้อกำหนดของระบบ`
      );
    }
    const modifiedAt = value.modifiedTime
      ? new Date(value.modifiedTime)
      : null;
    if (modifiedAt && Number.isNaN(modifiedAt.getTime())) {
      throw new BadRequestException(`วันที่แก้ไขของ ${filename} ไม่ถูกต้อง`);
    }
    return {
      googleFileId: value.id,
      filename,
      extension,
      title: titleFromFilename(filename),
      mimeType: value.mimeType,
      sizeBytes,
      md5Checksum: value.md5Checksum || null,
      headRevisionId: value.headRevisionId || null,
      sourceModifiedAt: modifiedAt
    };
  }

  async createImports(
    userId: string,
    fileIds: string[],
    categoryId: string | null | undefined
  ) {
    const systemConfig = await this.prisma.systemConfig.findUnique({
      where: { id: 1 },
      select: { uploadsEnabled: true, defaultCategoryId: true }
    });
    if (systemConfig?.uploadsEnabled === false) {
      throw new ConflictException("ระบบปิดรับการอัปโหลดวิดีโอชั่วคราว");
    }
    const effectiveCategoryId =
      categoryId === undefined
        ? systemConfig?.defaultCategoryId || null
        : categoryId;
    if (effectiveCategoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: effectiveCategoryId, active: true },
        select: { id: true }
      });
      if (!category) throw new BadRequestException("ไม่พบหมวดหมู่ที่เลือก");
    }
    const { connection, accessToken } = await this.accessToken(userId);
    const results: GoogleDriveImport[] = [];
    for (const fileId of fileIds) {
      const metadata = this.validateMetadata(
        await this.fileMetadata(accessToken, fileId)
      );
      const existing = await this.prisma.googleDriveImport.findFirst({
        where: {
          connectionId: connection.id,
          googleFileId: metadata.googleFileId,
          sourceModifiedAt: metadata.sourceModifiedAt,
          status: { in: [...ACTIVE_IMPORT_STATUSES, "COMPLETED"] }
        },
        orderBy: { createdAt: "desc" }
      });
      if (existing) {
        results.push(existing);
        continue;
      }
      const videoId = randomUUID();
      const fileIdValue = randomUUID();
      const storageKey = `originals/${videoId}/${fileIdValue}${metadata.extension}`;
      const created = await this.prisma.$transaction(async transaction => {
        const video = await transaction.video.create({
          data: {
            id: videoId,
            title: metadata.title,
            status: "UPLOADING",
            fileSize: metadata.sizeBytes,
            mimeType: metadata.mimeType,
            originalFilename: metadata.filename,
            uploadedById: userId,
            categoryId: effectiveCategoryId
          }
        });
        const imported = await transaction.googleDriveImport.create({
          data: {
            userId,
            connectionId: connection.id,
            googleFileId: metadata.googleFileId,
            headRevisionId: metadata.headRevisionId,
            sourceModifiedAt: metadata.sourceModifiedAt,
            md5Checksum: metadata.md5Checksum,
            filename: metadata.filename,
            title: metadata.title,
            mimeType: metadata.mimeType,
            sizeBytes: metadata.sizeBytes,
            categoryId: effectiveCategoryId,
            videoId: video.id,
            fileId: fileIdValue,
            storageKey
          }
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: userId,
            action: "GOOGLE_DRIVE_IMPORT_QUEUED",
            entityType: "GoogleDriveImport",
            entityId: imported.id,
            metadataJson: {
              videoId: video.id,
              filename: metadata.filename,
              sizeBytes: metadata.sizeBytes.toString()
            }
          }
        });
        return imported;
      });
      try {
        await this.queue.enqueue(created.id);
      } catch {
        await this.prisma.$transaction([
          this.prisma.googleDriveImport.update({
            where: { id: created.id },
            data: {
              status: "FAILED",
              errorCode: "IMPORT_QUEUE_UNAVAILABLE",
              errorMessage: "ไม่สามารถส่งงานเข้าสู่คิวประมวลผลได้"
            }
          }),
          this.prisma.video.update({
            where: { id: created.videoId },
            data: {
              status: "FAILED",
              processingError: "ไม่สามารถส่งงานนำเข้า Google Drive เข้าคิวได้"
            }
          })
        ]);
        throw new ServiceUnavailableException(
          "คิวนำเข้า Google Drive ยังไม่พร้อมใช้งาน"
        );
      }
      results.push(created);
    }
    return { imports: results.map(serializeImport) };
  }

  async listImports(userId: string) {
    const imports = await this.prisma.googleDriveImport.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 30
    });
    return { imports: imports.map(serializeImport) };
  }

  private async ownedImport(userId: string, id: string) {
    const imported = await this.prisma.googleDriveImport.findFirst({
      where: { id, userId }
    });
    if (!imported) throw new NotFoundException("ไม่พบงานนำเข้า Google Drive");
    return imported;
  }

  async cancelImport(userId: string, id: string) {
    const imported = await this.ownedImport(userId, id);
    if (imported.status === "COMPLETED") {
      throw new ConflictException("งานนำเข้านี้เสร็จสิ้นแล้ว");
    }
    await this.prisma.$transaction([
      this.prisma.googleDriveImport.update({
        where: { id },
        data: {
          status: "CANCELLED",
          errorCode: null,
          errorMessage: null
        }
      }),
      this.prisma.video.update({
        where: { id: imported.videoId },
        data: {
          status: "FAILED",
          processingError: "ผู้ใช้ยกเลิกการนำเข้าจาก Google Drive"
        }
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: "GOOGLE_DRIVE_IMPORT_CANCELLED",
          entityType: "GoogleDriveImport",
          entityId: id,
          metadataJson: { videoId: imported.videoId }
        }
      })
    ]);
    await this.queue.removeWaiting(id).catch(() => undefined);
    return { cancelled: true };
  }

  async retryImport(userId: string, id: string) {
    const imported = await this.ownedImport(userId, id);
    if (!["FAILED", "CANCELLED"].includes(imported.status)) {
      throw new ConflictException("งานนำเข้านี้ยังไม่อยู่ในสถานะที่ลองใหม่ได้");
    }
    const connection = await this.prisma.googleDriveConnection.findUnique({
      where: { userId },
      select: { id: true }
    });
    if (!connection) {
      throw new ConflictException("กรุณาเชื่อมต่อ Google Drive ก่อนลองใหม่");
    }
    await this.prisma.$transaction([
      this.prisma.googleDriveImport.update({
        where: { id },
        data: {
          connectionId: connection.id,
          status: "QUEUED",
          progress: 0,
          transferredBytes: 0,
          storageUploadId: null,
          errorCode: null,
          errorMessage: null,
          startedAt: null,
          completedAt: null
        }
      }),
      this.prisma.video.update({
        where: { id: imported.videoId },
        data: { status: "UPLOADING", processingError: null }
      })
    ]);
    await this.queue.enqueue(id);
    return { queued: true };
  }

  async disconnect(userId: string) {
    const active = await this.prisma.googleDriveImport.count({
      where: { userId, status: { in: ACTIVE_IMPORT_STATUSES } }
    });
    if (active > 0) {
      throw new ConflictException(
        "กรุณารอหรือยกเลิกงานนำเข้าที่กำลังทำงานก่อนถอดการเชื่อมต่อ"
      );
    }
    const connection = await this.prisma.googleDriveConnection.findUnique({
      where: { userId }
    });
    if (!connection) return { disconnected: true, idempotent: true };
    const refreshToken = decryptGoogleSecret(connection.refreshTokenEncrypted);
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
      signal: AbortSignal.timeout(10_000)
    }).catch(() => undefined);
    await this.prisma.$transaction([
      this.prisma.googleDriveConnection.delete({ where: { userId } }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: "GOOGLE_DRIVE_DISCONNECTED",
          entityType: "GoogleDriveConnection",
          entityId: connection.id,
          metadataJson: { email: connection.email }
        }
      })
    ]);
    return { disconnected: true, idempotent: false };
  }
}
