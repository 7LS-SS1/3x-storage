import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Req,
  UseGuards
} from "@nestjs/common";
import { z } from "zod";
import {
  AdminSessionGuard,
  CsrfGuard,
  type AdminRequest
} from "./admin-auth.guard";
import { PrismaService } from "./prisma.service";

const updateSchema = z
  .object({
    siteName: z.string().trim().min(1).max(80).optional(),
    uploadsEnabled: z.boolean().optional(),
    defaultCategoryId: z.string().trim().min(1).max(128).nullable().optional(),
    supportEmail: z
      .union([z.string().trim().email().max(254), z.null()])
      .optional(),
    storageWarningPercent: z.number().int().min(50).max(99).optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0);

function configuredInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value || fallback);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function configuredUrl(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

@Controller("settings")
@UseGuards(AdminSessionGuard, CsrfGuard)
export class SystemSettingsController {
  constructor(private readonly prisma: PrismaService) {}

  private async config() {
    return this.prisma.systemConfig.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
      select: {
        id: true,
        siteName: true,
        uploadsEnabled: true,
        defaultCategoryId: true,
        defaultCategory: { select: { id: true, name: true, active: true } },
        supportEmail: true,
        storageWarningPercent: true,
        updatedAt: true,
        updatedBy: { select: { id: true, name: true, email: true } }
      }
    });
  }

  @Get()
  async get(@Req() request: AdminRequest) {
    const canInspectRuntime = request.auth.user.role !== "STAFF";
    return {
      config: await this.config(),
      runtime: canInspectRuntime ? {
        environment: process.env.NODE_ENV || "development",
        storageDriver: process.env.STORAGE_DRIVER === "r2" ? "r2" : "s3",
        storageBucket:
          process.env.STORAGE_DRIVER === "r2"
            ? process.env.R2_BUCKET || null
            : process.env.S3_BUCKET || null,
        adminOrigin: configuredUrl(process.env.ADMIN_URL),
        playerOrigin: configuredUrl(process.env.PLAYER_URL),
        mediaOrigin: configuredUrl(process.env.MEDIA_URL),
        trustProxy: process.env.TRUST_PROXY === "true",
        apiDocsEnabled: process.env.ENABLE_API_DOCS === "true",
        analyticsConfigured: Boolean(process.env.ANALYTICS_ENGINE_DATASET),
        sessionIdleMinutes: Math.round(
          configuredInteger(process.env.SESSION_TTL_SECONDS, 3600) / 60
        ),
        sessionAbsoluteHours:
          configuredInteger(process.env.SESSION_ABSOLUTE_TTL_SECONDS, 28_800) / 3600,
        secretsConfigured: {
          session: Boolean(process.env.SESSION_SECRET),
          csrf: Boolean(process.env.CSRF_SECRET),
          mediaSigning: Boolean(process.env.MEDIA_SIGNING_SECRET),
          storage:
            process.env.STORAGE_DRIVER === "r2"
              ? Boolean(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)
              : Boolean(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY),
          googleDrive: Boolean(
            process.env.GOOGLE_CLIENT_ID &&
              process.env.GOOGLE_CLIENT_SECRET &&
              process.env.GOOGLE_PICKER_API_KEY &&
              process.env.GOOGLE_CLOUD_PROJECT_NUMBER &&
              /^[a-f0-9]{64}$/i.test(
                process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || ""
              )
          )
        }
      } : null
    };
  }

  @Patch()
  async update(@Req() request: AdminRequest, @Body() body: unknown) {
    if (request.auth.user.role !== "SYSTEM") {
      throw new ForbiddenException("เฉพาะบัญชี SYSTEM เท่านั้นที่แก้การตั้งค่าระบบได้");
    }
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ข้อมูลการตั้งค่าระบบไม่ถูกต้อง");
    if (parsed.data.defaultCategoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: parsed.data.defaultCategoryId, active: true },
        select: { id: true }
      });
      if (!category) throw new BadRequestException("ไม่พบหมวดหมู่เริ่มต้นที่เลือก");
    }
    await this.prisma.$transaction(async transaction => {
      await transaction.systemConfig.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          ...parsed.data,
          updatedById: request.auth.user.id
        },
        update: {
          ...parsed.data,
          updatedById: request.auth.user.id
        }
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: request.auth.user.id,
          action: "SYSTEM_SETTINGS_UPDATED",
          entityType: "SystemConfig",
          entityId: "1",
          metadataJson: { fields: Object.keys(parsed.data) },
          userAgent: request.headers["user-agent"]?.slice(0, 512)
        }
      });
    });
    return { config: await this.config() };
  }
}
