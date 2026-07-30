import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
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
import { Role } from "@prisma/client";
import argon2 from "argon2";
import { z } from "zod";
import {
  AdminSessionGuard,
  CsrfGuard,
  type AdminRequest
} from "./admin-auth.guard";
import { PrismaService } from "./prisma.service";

const roleSchema = z.nativeEnum(Role);
const passwordSchema = z.string().min(8).max(1024);
const createSchema = z
  .object({
    email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
    name: z.string().trim().min(1).max(120),
    password: passwordSchema,
    role: roleSchema.default(Role.STAFF),
    active: z.boolean().default(true)
  })
  .strict();
const updateSchema = z
  .object({
    email: z.string().trim().email().max(254).transform(value => value.toLowerCase()).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    password: passwordSchema.optional(),
    role: roleSchema.optional(),
    active: z.boolean().optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0);
const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().refine(value => [10, 20, 30, 50, 100].includes(value)).default(20),
    search: z.string().trim().max(120).optional(),
    role: roleSchema.optional(),
    status: z.enum(["active", "inactive"]).optional()
  })
  .strict();

function assertStrongEnough(password: string) {
  if (/^(password|123456|12345678|123456789|qwerty|admin)/i.test(password)) {
    throw new BadRequestException("รหัสผ่านนี้คาดเดาง่ายเกินไป");
  }
}

async function hashPassword(password: string) {
  assertStrongEnough(password);
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1
  });
}

@Controller("users")
@UseGuards(AdminSessionGuard, CsrfGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  private assertManager(request: AdminRequest) {
    if (request.auth.user.role === Role.STAFF) {
      throw new ForbiddenException("บัญชี STAFF ไม่มีสิทธิ์จัดการผู้ใช้งาน");
    }
  }

  private assertCanManageRole(request: AdminRequest, targetRole: Role) {
    this.assertManager(request);
    if (request.auth.user.role === Role.ADMIN && targetRole !== Role.STAFF) {
      throw new ForbiddenException("บัญชี ADMIN จัดการได้เฉพาะบัญชี STAFF");
    }
  }

  private async assertSystemContinuity(
    targetId: string,
    currentRole: Role,
    nextRole: Role,
    nextActive: boolean
  ) {
    if (currentRole !== Role.SYSTEM || (nextRole === Role.SYSTEM && nextActive)) return;
    const remaining = await this.prisma.user.count({
      where: {
        id: { not: targetId },
        role: Role.SYSTEM,
        active: true
      }
    });
    if (remaining < 1) {
      throw new ConflictException("ต้องมีบัญชี SYSTEM ที่เปิดใช้งานอย่างน้อยหนึ่งบัญชี");
    }
  }

  @Get()
  async list(
    @Req() request: AdminRequest,
    @Query() query: Record<string, unknown>
  ) {
    this.assertManager(request);
    const parsed = listSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("ตัวกรองผู้ใช้งานไม่ถูกต้อง");
    const { page, pageSize, search, role, status } = parsed.data;
    const effectiveRole =
      request.auth.user.role === Role.ADMIN ? Role.STAFF : role;
    const where = {
      ...(effectiveRole ? { role: effectiveRole } : {}),
      ...(status ? { active: status === "active" } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } }
            ]
          }
        : {})
    };
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ active: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          active: true,
          failedLoginCount: true,
          lockedUntil: true,
          lastLoginAt: true,
          createdAt: true,
          _count: {
            select: {
              videos: { where: { deletedAt: null } },
              sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } }
            }
          }
        }
      })
    ]);
    return {
      data: users.map(user => ({
        ...user,
        videoCount: user._count.videos,
        activeSessionCount: user._count.sessions,
        _count: undefined
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      }
    };
  }

  @Post()
  async create(@Req() request: AdminRequest, @Body() body: unknown) {
    this.assertManager(request);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ข้อมูลผู้ใช้งานไม่ถูกต้อง");
    this.assertCanManageRole(request, parsed.data.role);
    const duplicate = await this.prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true }
    });
    if (duplicate) throw new ConflictException("อีเมลนี้มีบัญชีอยู่แล้ว");
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await this.prisma.$transaction(async transaction => {
      const created = await transaction.user.create({
        data: {
          email: parsed.data.email,
          name: parsed.data.name,
          passwordHash,
          role: parsed.data.role,
          active: parsed.data.active
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          active: true,
          createdAt: true
        }
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: request.auth.user.id,
          action: "USER_CREATED",
          entityType: "User",
          entityId: created.id,
          metadataJson: {
            email: created.email,
            role: created.role,
            active: created.active
          },
          userAgent: request.headers["user-agent"]?.slice(0, 512)
        }
      });
      return created;
    });
    return { user };
  }

  @Patch(":id")
  async update(
    @Req() request: AdminRequest,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    this.assertManager(request);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ข้อมูลแก้ไขผู้ใช้งานไม่ถูกต้อง");
    const current = await this.prisma.user.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("ไม่พบผู้ใช้งาน");
    this.assertCanManageRole(request, current.role);
    const nextRole = parsed.data.role || current.role;
    this.assertCanManageRole(request, nextRole);
    const nextActive = parsed.data.active ?? current.active;
    if (
      request.auth.user.id === current.id &&
      ((parsed.data.role !== undefined && parsed.data.role !== current.role) ||
        parsed.data.active === false)
    ) {
      throw new ConflictException("ไม่สามารถลดสิทธิ์หรือปิดบัญชีที่กำลังใช้งานอยู่");
    }
    await this.assertSystemContinuity(current.id, current.role, nextRole, nextActive);
    if (parsed.data.email && parsed.data.email !== current.email) {
      const duplicate = await this.prisma.user.findUnique({
        where: { email: parsed.data.email },
        select: { id: true }
      });
      if (duplicate) throw new ConflictException("อีเมลนี้มีบัญชีอยู่แล้ว");
    }
    const passwordHash = parsed.data.password
      ? await hashPassword(parsed.data.password)
      : undefined;
    const revokeSessions =
      Boolean(passwordHash) ||
      parsed.data.role !== undefined ||
      parsed.data.active === false;
    const now = new Date();
    const user = await this.prisma.$transaction(async transaction => {
      const updated = await transaction.user.update({
        where: { id },
        data: {
          ...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.role !== undefined ? { role: parsed.data.role } : {}),
          ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
          ...(passwordHash ? { passwordHash, failedLoginCount: 0, lockedUntil: null } : {})
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          active: true,
          updatedAt: true
        }
      });
      if (revokeSessions) {
        await transaction.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: now }
        });
      }
      await transaction.auditLog.create({
        data: {
          actorUserId: request.auth.user.id,
          action: "USER_UPDATED",
          entityType: "User",
          entityId: id,
          metadataJson: {
            fields: Object.keys(parsed.data),
            sessionsRevoked: revokeSessions
          },
          userAgent: request.headers["user-agent"]?.slice(0, 512)
        }
      });
      return updated;
    });
    return { user, sessionsRevoked: revokeSessions };
  }

  @Post(":id/revoke-sessions")
  async revokeSessions(@Req() request: AdminRequest, @Param("id") id: string) {
    this.assertManager(request);
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true }
    });
    if (!target) throw new NotFoundException("ไม่พบผู้ใช้งาน");
    this.assertCanManageRole(request, target.role);
    const now = new Date();
    const result = await this.prisma.$transaction(async transaction => {
      const revoked = await transaction.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now }
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: request.auth.user.id,
          action: "USER_SESSIONS_REVOKED",
          entityType: "User",
          entityId: id,
          metadataJson: { count: revoked.count },
          userAgent: request.headers["user-agent"]?.slice(0, 512)
        }
      });
      return revoked;
    });
    return { revokedCount: result.count };
  }
}
