import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand
} from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import { Job, Worker } from "bullmq";
import IORedis from "ioredis";
import {
  createDecipheriv,
  createHash
} from "node:crypto";
import { extname } from "node:path";

const prisma = new PrismaClient();
const MIN_PART_SIZE = 5 * 1024 ** 2;
const MAX_PART_SIZE = 1024 ** 3;

class ImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = true
  ) {
    super(message);
  }
}

class ImportCancelledError extends Error {}

function required(name: string, value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized.startsWith("replace-with")) {
    throw new ImportError(
      `MISSING_${name}`,
      `ยังไม่ได้ตั้งค่า ${name}`,
      false
    );
  }
  return normalized;
}

function encryptionKey() {
  const value = required(
    "GOOGLE_TOKEN_ENCRYPTION_KEY",
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
  );
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new ImportError(
      "INVALID_GOOGLE_TOKEN_ENCRYPTION_KEY",
      "GOOGLE_TOKEN_ENCRYPTION_KEY ต้องเป็นค่า hex 256-bit",
      false
    );
  }
  return Buffer.from(value, "hex");
}

function decryptGoogleSecret(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (
    version !== "v1" ||
    !ivValue ||
    !tagValue ||
    encryptedValue === undefined
  ) {
    throw new ImportError(
      "INVALID_GOOGLE_TOKEN",
      "ข้อมูลยืนยันตัวตน Google Drive ไม่ถูกต้อง",
      false
    );
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivValue, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new ImportError(
      "GOOGLE_TOKEN_DECRYPT_FAILED",
      "ไม่สามารถอ่านข้อมูลยืนยันตัวตน Google Drive ได้",
      false
    );
  }
}

function storageConfiguration() {
  const driver = process.env.STORAGE_DRIVER === "r2" ? "r2" : "s3";
  if (driver === "r2") {
    const accountId = process.env.R2_ACCOUNT_ID?.trim();
    return {
      bucket: required("R2_BUCKET", process.env.R2_BUCKET),
      endpoint: required(
        "R2_S3_ENDPOINT",
        process.env.R2_S3_ENDPOINT ||
          (accountId
            ? `https://${accountId}.r2.cloudflarestorage.com`
            : undefined)
      ),
      region: "auto",
      accessKeyId: required("R2_ACCESS_KEY_ID", process.env.R2_ACCESS_KEY_ID),
      secretAccessKey: required(
        "R2_SECRET_ACCESS_KEY",
        process.env.R2_SECRET_ACCESS_KEY
      ),
      forcePathStyle: false
    };
  }
  return {
    bucket: required("S3_BUCKET", process.env.S3_BUCKET),
    endpoint: required("S3_ENDPOINT", process.env.S3_ENDPOINT),
    region: process.env.S3_REGION?.trim() || "auto",
    accessKeyId: required("S3_ACCESS_KEY_ID", process.env.S3_ACCESS_KEY_ID),
    secretAccessKey: required(
      "S3_SECRET_ACCESS_KEY",
      process.env.S3_SECRET_ACCESS_KEY
    ),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false"
  };
}

function partSizeBytes() {
  const parsed = Number(process.env.UPLOAD_PART_SIZE_BYTES || 64 * 1024 ** 2);
  if (!Number.isSafeInteger(parsed)) return 64 * 1024 ** 2;
  return Math.min(Math.max(parsed, MIN_PART_SIZE), MAX_PART_SIZE);
}

function hasVideoSignature(extension: string, bytes: Buffer) {
  const ascii = (start: number, end: number) =>
    bytes.subarray(start, end).toString("ascii");
  const hex = (start: number, end: number) =>
    bytes.subarray(start, end).toString("hex");
  if ([".mp4", ".m4v", ".mov"].includes(extension)) {
    return ascii(4, 8) === "ftyp";
  }
  if ([".webm", ".mkv"].includes(extension)) {
    return hex(0, 4) === "1a45dfa3";
  }
  if (extension === ".avi") {
    return ascii(0, 4) === "RIFF" && ascii(8, 12) === "AVI ";
  }
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

async function refreshAccessToken(refreshTokenEncrypted: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      client_id: required("GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID),
      client_secret: required(
        "GOOGLE_CLIENT_SECRET",
        process.env.GOOGLE_CLIENT_SECRET
      ),
      refresh_token: decryptGoogleSecret(refreshTokenEncrypted),
      grant_type: "refresh_token"
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new ImportError(
      "GOOGLE_TOKEN_REFRESH_FAILED",
      "สิทธิ์เข้าถึง Google Drive หมดอายุหรือถูกเพิกถอน",
      false
    );
  }
  return payload.access_token;
}

async function downloadRange(
  accessToken: string,
  fileId: string,
  start: number,
  end: number,
  totalSize: number
) {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`
  );
  url.searchParams.set("alt", "media");
  url.searchParams.set("supportsAllDrives", "true");
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Range: `bytes=${start}-${end}`,
      Accept: "application/octet-stream"
    },
    signal: AbortSignal.timeout(120_000)
  });
  const expectedLength = end - start + 1;
  if (
    !response.ok ||
    (response.status !== 206 && !(start === 0 && expectedLength === totalSize))
  ) {
    if (response.status === 401 || response.status === 403) {
      throw new ImportError(
        "GOOGLE_FILE_ACCESS_DENIED",
        "ไม่มีสิทธิ์ดาวน์โหลดไฟล์จาก Google Drive",
        false
      );
    }
    throw new ImportError(
      "GOOGLE_DOWNLOAD_FAILED",
      `ดาวน์โหลดข้อมูลจาก Google Drive ไม่สำเร็จ (HTTP ${response.status})`
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== expectedLength) {
    throw new ImportError(
      "GOOGLE_RANGE_SIZE_MISMATCH",
      "ขนาดข้อมูลที่ได้รับจาก Google Drive ไม่ตรงกับช่วงที่ร้องขอ"
    );
  }
  return bytes;
}

async function ensureNotCancelled(importId: string) {
  const current = await prisma.googleDriveImport.findUnique({
    where: { id: importId },
    select: { status: true }
  });
  if (!current || current.status === "CANCELLED") {
    throw new ImportCancelledError();
  }
}

function safeError(error: unknown) {
  if (error instanceof ImportError) {
    return {
      code: error.code.slice(0, 120),
      message: error.message.slice(0, 500),
      retryable: error.retryable
    };
  }
  return {
    code: error instanceof Error
      ? error.name.slice(0, 120)
      : "DRIVE_IMPORT_FAILED",
    message: "การนำเข้าจาก Google Drive ขัดข้อง กรุณาลองใหม่",
    retryable: true
  };
}

async function processImport(job: Job<{ importId: string }>) {
  const importId = job.data.importId;
  const claimed = await prisma.googleDriveImport.updateMany({
    where: {
      id: importId,
      status: {
        in: [
          "QUEUED",
          "VALIDATING",
          "TRANSFERRING",
          "COMPLETING",
          "FAILED"
        ]
      }
    },
    data: {
      status: "VALIDATING",
      progress: 1,
      transferredBytes: 0,
      attempts: { increment: 1 },
      errorCode: null,
      errorMessage: null,
      startedAt: new Date(),
      completedAt: null
    }
  });
  if (claimed.count !== 1) return;

  const imported = await prisma.googleDriveImport.findUnique({
    where: { id: importId },
    include: { connection: true }
  });
  if (!imported?.connection) {
    job.discard();
    if (imported) {
      await prisma.$transaction([
        prisma.googleDriveImport.update({
          where: { id: importId },
          data: {
            status: "FAILED",
            errorCode: "GOOGLE_CONNECTION_MISSING",
            errorMessage: "ไม่พบบัญชี Google Drive ที่เชื่อมต่อ"
          }
        }),
        prisma.video.update({
          where: { id: imported.videoId },
          data: {
            status: "FAILED",
            processingError: "ไม่พบบัญชี Google Drive ที่เชื่อมต่อ"
          }
        })
      ]);
    }
    throw new ImportError(
      "GOOGLE_CONNECTION_MISSING",
      "ไม่พบบัญชี Google Drive ที่เชื่อมต่อ",
      false
    );
  }

  let storage: ReturnType<typeof storageConfiguration> | null = null;
  let client: S3Client | null = null;
  let uploadId: string | null = null;
  let objectCompleted = false;

  try {
    storage = storageConfiguration();
    client = new S3Client({
      endpoint: storage.endpoint,
      region: storage.region,
      forcePathStyle: storage.forcePathStyle,
      credentials: {
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey
      }
    });
    const accessToken = await refreshAccessToken(
      imported.connection.refreshTokenEncrypted
    );
    const sizeBytes = Number(imported.sizeBytes);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      throw new ImportError(
        "INVALID_IMPORT_SIZE",
        "ขนาดไฟล์นำเข้าไม่ถูกต้อง",
        false
      );
    }
    const signature = await downloadRange(
      accessToken,
      imported.googleFileId,
      0,
      Math.min(511, sizeBytes - 1),
      sizeBytes
    );
    if (!hasVideoSignature(extname(imported.filename).toLowerCase(), signature)) {
      throw new ImportError(
        "INVALID_VIDEO_SIGNATURE",
        "เนื้อหาไฟล์จาก Google Drive ไม่ตรงกับรูปแบบวิดีโอที่รองรับ",
        false
      );
    }
    await ensureNotCancelled(importId);

    const initiated = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: storage.bucket,
        Key: imported.storageKey,
        ContentType: imported.mimeType,
        Metadata: {
          source: "google-drive",
          import: imported.id
        }
      })
    );
    if (!initiated.UploadId) {
      throw new ImportError(
        "STORAGE_UPLOAD_ID_MISSING",
        "พื้นที่จัดเก็บไม่ส่งรหัส multipart upload"
      );
    }
    uploadId = initiated.UploadId;
    await prisma.googleDriveImport.update({
      where: { id: importId },
      data: {
        storageUploadId: uploadId,
        status: "TRANSFERRING",
        progress: 3
      }
    });

    const chunkSize = partSizeBytes();
    const partCount = Math.ceil(sizeBytes / chunkSize);
    if (partCount > 10_000) {
      throw new ImportError(
        "TOO_MANY_MULTIPART_PARTS",
        "ไฟล์มีจำนวนส่วนเกินขีดจำกัด multipart",
        false
      );
    }
    const completedParts: Array<{ ETag: string; PartNumber: number }> = [];
    let transferredBytes = 0;
    const checksum = createHash("md5");

    for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
      await ensureNotCancelled(importId);
      const start = (partNumber - 1) * chunkSize;
      const end = Math.min(sizeBytes - 1, start + chunkSize - 1);
      const body = await downloadRange(
        accessToken,
        imported.googleFileId,
        start,
        end,
        sizeBytes
      );
      checksum.update(body);
      const result = await client.send(
        new UploadPartCommand({
          Bucket: storage.bucket,
          Key: imported.storageKey,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body,
          ContentLength: body.length
        })
      );
      if (!result.ETag) {
        throw new ImportError(
          "STORAGE_PART_ETAG_MISSING",
          "พื้นที่จัดเก็บไม่ส่ง ETag ของส่วนไฟล์"
        );
      }
      completedParts.push({ ETag: result.ETag, PartNumber: partNumber });
      transferredBytes += body.length;
      await prisma.googleDriveImport.update({
        where: { id: importId },
        data: {
          transferredBytes: BigInt(transferredBytes),
          progress: Math.min(
            96,
            3 + Math.floor((transferredBytes / sizeBytes) * 93)
          )
        }
      });
    }

    await ensureNotCancelled(importId);
    if (
      imported.md5Checksum &&
      checksum.digest("hex").toLowerCase() !== imported.md5Checksum.toLowerCase()
    ) {
      throw new ImportError(
        "GOOGLE_FILE_CHECKSUM_MISMATCH",
        "Checksum ของไฟล์ที่ถ่ายโอนไม่ตรงกับ Google Drive"
      );
    }
    await prisma.googleDriveImport.update({
      where: { id: importId },
      data: { status: "COMPLETING", progress: 98 }
    });
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: storage.bucket,
        Key: imported.storageKey,
        UploadId: uploadId,
        MultipartUpload: { Parts: completedParts }
      })
    );
    uploadId = null;
    objectCompleted = true;
    const object = await client.send(
      new HeadObjectCommand({
        Bucket: storage.bucket,
        Key: imported.storageKey
      })
    );
    if (Number(object.ContentLength || 0) !== sizeBytes) {
      throw new ImportError(
        "STORAGE_OBJECT_SIZE_MISMATCH",
        "ขนาดไฟล์ในพื้นที่จัดเก็บไม่ตรงกับไฟล์ต้นฉบับ",
        false
      );
    }
    const completedAt = new Date();
    await prisma.$transaction([
      prisma.videoFile.upsert({
        where: { id: imported.fileId },
        create: {
          id: imported.fileId,
          videoId: imported.videoId,
          role: "ORIGINAL",
          storageKey: imported.storageKey,
          filename: imported.filename,
          extension: extname(imported.filename).toLowerCase(),
          mimeType: imported.mimeType,
          sizeBytes: imported.sizeBytes,
          checksum: imported.md5Checksum
        },
        update: {
          mimeType: imported.mimeType,
          sizeBytes: imported.sizeBytes,
          checksum: imported.md5Checksum
        }
      }),
      prisma.video.update({
        where: { id: imported.videoId },
        data: {
          status: "UPLOADED",
          originalKey: imported.storageKey,
          fileSize: imported.sizeBytes,
          mimeType: imported.mimeType,
          uploadedAt: completedAt,
          processingError: null
        }
      }),
      prisma.googleDriveImport.update({
        where: { id: importId },
        data: {
          status: "COMPLETED",
          progress: 100,
          transferredBytes: imported.sizeBytes,
          storageUploadId: null,
          completedAt,
          errorCode: null,
          errorMessage: null
        }
      }),
      prisma.auditLog.create({
        data: {
          actorUserId: imported.userId,
          action: "GOOGLE_DRIVE_IMPORT_COMPLETED",
          entityType: "GoogleDriveImport",
          entityId: importId,
          metadataJson: {
            videoId: imported.videoId,
            filename: imported.filename,
            sizeBytes: imported.sizeBytes.toString(),
            partCount
          }
        }
      })
    ]);
  } catch (error) {
    if (uploadId && client && storage) {
      await client
        .send(
          new AbortMultipartUploadCommand({
            Bucket: storage.bucket,
            Key: imported.storageKey,
            UploadId: uploadId
          })
        )
        .catch(() => undefined);
    }
    if (objectCompleted && client && storage) {
      await client
        .send(
          new DeleteObjectCommand({
            Bucket: storage.bucket,
            Key: imported.storageKey
          })
        )
        .catch(() => undefined);
    }
    if (error instanceof ImportCancelledError) return;

    const safe = safeError(error);
    const maxAttempts =
      typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
    const finalAttempt =
      !safe.retryable || job.attemptsMade + 1 >= maxAttempts;
    if (!safe.retryable) job.discard();
    await prisma.$transaction([
      prisma.googleDriveImport.update({
        where: { id: importId },
        data: {
          status: finalAttempt ? "FAILED" : "QUEUED",
          storageUploadId: null,
          errorCode: safe.code,
          errorMessage: safe.message
        }
      }),
      prisma.video.update({
        where: { id: imported.videoId },
        data: {
          status: finalAttempt ? "FAILED" : "UPLOADING",
          processingError: finalAttempt ? safe.message : null
        }
      }),
      ...(finalAttempt
        ? [
            prisma.auditLog.create({
              data: {
                actorUserId: imported.userId,
                action: "GOOGLE_DRIVE_IMPORT_FAILED",
                entityType: "GoogleDriveImport",
                entityId: importId,
                metadataJson: {
                  videoId: imported.videoId,
                  errorCode: safe.code
                }
              }
            })
          ]
        : [])
    ]);
    throw error;
  } finally {
    client?.destroy();
  }
}

export function createGoogleDriveImportWorker(connection: IORedis) {
  return new Worker<{ importId: string }>(
    "google-drive-import",
    processImport,
    {
      connection,
      concurrency: Math.min(
        Math.max(Number(process.env.DRIVE_IMPORT_CONCURRENCY || 2), 1),
        5
      ),
      lockDuration: 10 * 60_000,
      stalledInterval: 60_000,
      maxStalledCount: 2
    }
  );
}

export async function closeGoogleDriveImportResources() {
  await prisma.$disconnect();
}
