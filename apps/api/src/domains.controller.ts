import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { z } from "zod";
import {
  AdminSessionGuard,
  canManageAllVideos,
  CsrfGuard,
  type AdminRequest
} from "./admin-auth.guard";
import { PrismaService } from "./prisma.service";

const createSchema = z
  .object({
    hostname: z.string().trim().min(1).max(253),
    includeSubdomains: z.boolean().default(false),
    active: z.boolean().default(true)
  })
  .strict();
const updateSchema = z
  .object({
    hostname: z.string().trim().min(1).max(253).optional(),
    includeSubdomains: z.boolean().optional(),
    active: z.boolean().optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0);

function normalizeHostname(value: string) {
  let hostname = value.trim().toLowerCase().replace(/\.$/, "");
  try {
    const parsed = new URL(hostname.includes("://") ? hostname : `https://${hostname}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.port ||
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("INVALID_HOST");
    }
    hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    throw new BadRequestException("กรุณากรอกเฉพาะ hostname โดยไม่ใส่ path หรือ port");
  }
  const ascii = domainToASCII(hostname);
  if (!ascii || ascii.length > 253) throw new BadRequestException("hostname ไม่ถูกต้อง");
  if (ascii === "localhost" || isIP(ascii)) return ascii;
  const labels = ascii.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      label =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
  ) {
    throw new BadRequestException("hostname ไม่ถูกต้อง");
  }
  return ascii;
}

@Controller("domains")
@UseGuards(AdminSessionGuard, CsrfGuard)
export class DomainsController {
  constructor(private readonly prisma: PrismaService) {}

  private assertManager(request: AdminRequest) {
    if (!canManageAllVideos(request.auth.user.role)) {
      throw new ForbiddenException("บัญชี STAFF ไม่มีสิทธิ์จัดการโดเมน");
    }
  }

  @Get()
  async list(
    @Req() request: AdminRequest,
    @Query("search") search?: string,
    @Query("active") active?: string
  ) {
    this.assertManager(request);
    const normalizedSearch = search?.trim().slice(0, 120);
    const domains = await this.prisma.allowedDomain.findMany({
      where: {
        ...(normalizedSearch
          ? { hostname: { contains: normalizedSearch, mode: "insensitive" } }
          : {}),
        ...(active === "true" ? { active: true } : {}),
        ...(active === "false" ? { active: false } : {})
      },
      orderBy: [{ active: "desc" }, { hostname: "asc" }],
      select: {
        id: true,
        hostname: true,
        includeSubdomains: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            videos: true,
            playbackSessions: true
          }
        }
      }
    });
    return {
      domains: domains.map(domain => ({
        ...domain,
        videoCount: domain._count.videos,
        playbackSessionCount: domain._count.playbackSessions,
        _count: undefined
      }))
    };
  }

  @Post()
  async create(@Req() request: AdminRequest, @Body() body: unknown) {
    this.assertManager(request);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ข้อมูลโดเมนไม่ถูกต้อง");
    const hostname = normalizeHostname(parsed.data.hostname);
    const duplicate = await this.prisma.allowedDomain.findUnique({
      where: { hostname },
      select: { id: true }
    });
    if (duplicate) throw new ConflictException("hostname นี้มีอยู่แล้ว");
    const domain = await this.prisma.$transaction(async transaction => {
      const created = await transaction.allowedDomain.create({
        data: {
          hostname,
          includeSubdomains: parsed.data.includeSubdomains,
          active: parsed.data.active
        }
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: request.auth.user.id,
          action: "DOMAIN_CREATED",
          entityType: "AllowedDomain",
          entityId: created.id,
          metadataJson: {
            hostname,
            includeSubdomains: created.includeSubdomains
          },
          userAgent: request.headers["user-agent"]?.slice(0, 512)
        }
      });
      return created;
    });
    return { domain };
  }

  @Patch(":id")
  async update(
    @Req() request: AdminRequest,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    this.assertManager(request);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ข้อมูลแก้ไขโดเมนไม่ถูกต้อง");
    const current = await this.prisma.allowedDomain.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("ไม่พบโดเมน");
    const hostname = parsed.data.hostname
      ? normalizeHostname(parsed.data.hostname)
      : current.hostname;
    if (hostname !== current.hostname) {
      const duplicate = await this.prisma.allowedDomain.findUnique({
        where: { hostname },
        select: { id: true }
      });
      if (duplicate) throw new ConflictException("hostname นี้มีอยู่แล้ว");
    }
    const domain = await this.prisma.$transaction(async transaction => {
      const updated = await transaction.allowedDomain.update({
        where: { id },
        data: {
          ...(hostname !== current.hostname ? { hostname } : {}),
          ...(parsed.data.includeSubdomains !== undefined
            ? { includeSubdomains: parsed.data.includeSubdomains }
            : {}),
          ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {})
        }
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: request.auth.user.id,
          action: "DOMAIN_UPDATED",
          entityType: "AllowedDomain",
          entityId: id,
          metadataJson: { fields: Object.keys(parsed.data) },
          userAgent: request.headers["user-agent"]?.slice(0, 512)
        }
      });
      return updated;
    });
    return { domain };
  }

  @Delete(":id")
  async remove(@Req() request: AdminRequest, @Param("id") id: string) {
    this.assertManager(request);
    const current = await this.prisma.allowedDomain.findUnique({
      where: { id },
      select: {
        id: true,
        hostname: true,
        _count: { select: { videos: true, playbackSessions: true } }
      }
    });
    if (!current) throw new NotFoundException("ไม่พบโดเมน");
    if (current._count.videos > 0 || current._count.playbackSessions > 0) {
      throw new ConflictException("โดเมนนี้ยังผูกกับวิดีโอหรือประวัติการเล่นอยู่");
    }
    await this.prisma.$transaction([
      this.prisma.allowedDomain.delete({ where: { id } }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: request.auth.user.id,
          action: "DOMAIN_DELETED",
          entityType: "AllowedDomain",
          entityId: id,
          metadataJson: { hostname: current.hostname },
          userAgent: request.headers["user-agent"]?.slice(0, 512)
        }
      })
    ]);
    return { deleted: true };
  }
}
