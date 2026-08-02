import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";

type StorageConfiguration = {
  driver: "s3" | "r2";
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

type CompletedPart = {
  partNumber: number;
  etag: string;
};

function requiredValue(name: string, value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized.startsWith("replace-with")) {
    throw new ServiceUnavailableException(`ยังไม่ได้ตั้งค่าระบบจัดเก็บข้อมูล: ${name}`);
  }
  return normalized;
}

function readConfiguration(): StorageConfiguration {
  const driver = process.env.STORAGE_DRIVER === "r2" ? "r2" : "s3";
  if (driver === "r2") {
    const accountId = process.env.R2_ACCOUNT_ID?.trim();
    return {
      driver,
      bucket: requiredValue("R2_BUCKET", process.env.R2_BUCKET),
      endpoint: requiredValue(
        "R2_S3_ENDPOINT",
        process.env.R2_S3_ENDPOINT ||
          (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined)
      ),
      region: "auto",
      accessKeyId: requiredValue("R2_ACCESS_KEY_ID", process.env.R2_ACCESS_KEY_ID),
      secretAccessKey: requiredValue(
        "R2_SECRET_ACCESS_KEY",
        process.env.R2_SECRET_ACCESS_KEY
      ),
      forcePathStyle: false
    };
  }

  return {
    driver,
    bucket: requiredValue("S3_BUCKET", process.env.S3_BUCKET),
    endpoint: requiredValue("S3_ENDPOINT", process.env.S3_ENDPOINT),
    region: process.env.S3_REGION?.trim() || "auto",
    accessKeyId: requiredValue("S3_ACCESS_KEY_ID", process.env.S3_ACCESS_KEY_ID),
    secretAccessKey: requiredValue(
      "S3_SECRET_ACCESS_KEY",
      process.env.S3_SECRET_ACCESS_KEY
    ),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false"
  };
}

function safeStorageError(error: unknown) {
  if (error && typeof error === "object" && "name" in error) {
    return String(error.name).slice(0, 120);
  }
  return "STORAGE_OPERATION_FAILED";
}

@Injectable()
export class StorageService {
  private client: S3Client | null = null;
  private configuration: StorageConfiguration | null = null;

  private config() {
    if (!this.configuration) this.configuration = readConfiguration();
    return this.configuration;
  }

  private s3() {
    if (!this.client) {
      const config = this.config();
      this.client = new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey
        }
      });
    }
    return this.client;
  }

  bucketInfo() {
    const config = this.config();
    return {
      driver: config.driver,
      bucket: config.bucket,
      endpointHost: new URL(config.endpoint).host
    };
  }

  async health() {
    const config = this.config();
    try {
      await this.s3().send(new HeadBucketCommand({ Bucket: config.bucket }));
      return { connected: true as const, ...this.bucketInfo() };
    } catch (error) {
      return {
        connected: false as const,
        ...this.bucketInfo(),
        error: safeStorageError(error)
      };
    }
  }

  async createMultipartUpload(storageKey: string, mimeType: string) {
    const config = this.config();
    try {
      const result = await this.s3().send(
        new CreateMultipartUploadCommand({
          Bucket: config.bucket,
          Key: storageKey,
          ContentType: mimeType,
          Metadata: { source: "3x-storage-admin" }
        })
      );
      if (!result.UploadId) throw new Error("MISSING_UPLOAD_ID");
      return result.UploadId;
    } catch {
      throw new ServiceUnavailableException("ไม่สามารถเริ่มการอัปโหลดกับพื้นที่จัดเก็บได้");
    }
  }

  async presignPart(
    storageKey: string,
    uploadId: string,
    partNumber: number,
    expiresIn: number
  ) {
    const config = this.config();
    try {
      return await getSignedUrl(
        this.s3(),
        new UploadPartCommand({
          Bucket: config.bucket,
          Key: storageKey,
          UploadId: uploadId,
          PartNumber: partNumber
        }),
        { expiresIn }
      );
    } catch {
      throw new ServiceUnavailableException("ไม่สามารถสร้าง URL สำหรับอัปโหลดส่วนนี้ได้");
    }
  }

  async completeMultipartUpload(
    storageKey: string,
    uploadId: string,
    completedParts: CompletedPart[]
  ) {
    const config = this.config();
    await this.s3().send(
      new CompleteMultipartUploadCommand({
        Bucket: config.bucket,
        Key: storageKey,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: completedParts
            .slice()
            .sort((left, right) => left.partNumber - right.partNumber)
            .map(part => ({
              PartNumber: part.partNumber,
              ETag: part.etag
            }))
        }
      })
    );
  }

  async abortMultipartUpload(storageKey: string, uploadId: string) {
    const config = this.config();
    try {
      await this.s3().send(
        new AbortMultipartUploadCommand({
          Bucket: config.bucket,
          Key: storageKey,
          UploadId: uploadId
        })
      );
    } catch (error) {
      const name = safeStorageError(error);
      if (name !== "NoSuchUpload" && name !== "NotFound") throw error;
    }
  }

  async headObject(storageKey: string) {
    const config = this.config();
    try {
      const result = await this.s3().send(
        new HeadObjectCommand({ Bucket: config.bucket, Key: storageKey })
      );
      return {
        exists: true as const,
        sizeBytes: Number(result.ContentLength || 0),
        contentType: result.ContentType || null
      };
    } catch (error) {
      const name = safeStorageError(error);
      if (name === "NotFound" || name === "NoSuchKey") {
        return { exists: false as const, sizeBytes: 0, contentType: null };
      }
      throw error;
    }
  }

  async createReadUrl(storageKey: string, expiresIn = 300) {
    const config = this.config();
    return getSignedUrl(
      this.s3(),
      new GetObjectCommand({ Bucket: config.bucket, Key: storageKey }),
      { expiresIn }
    );
  }

  async putObject(storageKey: string, body: Buffer, contentType: string) {
    const config = this.config();
    await this.s3().send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: storageKey,
      Body: body,
      ContentType: contentType,
      CacheControl: "private, max-age=300"
    }));
  }

  async deleteObject(storageKey: string) {
    const config = this.config();
    await this.s3().send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey })
    );
  }
}
