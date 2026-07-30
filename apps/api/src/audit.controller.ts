import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
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

const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().refine(value => [20, 50, 100].includes(value)).default(50),
    search: z.string().trim().max(120).optional(),
    action: z.string().trim().max(120).optional(),
    entityType: z.string().trim().max(120).optional(),
    actorUserId: z.string().trim().max(128).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional()
  })
  .strict();

@Controller("audit")
@UseGuards(AdminSessionGuard, CsrfGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Req() request: AdminRequest,
    @Query() query: Record<string, unknown>
  ) {
    if (request.auth.user.role === "STAFF") {
      throw new ForbiddenException("บัญชี STAFF ไม่มีสิทธิ์ดูบันทึกกิจกรรม");
    }
    const parsed = listSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("ตัวกรองบันทึกกิจกรรมไม่ถูกต้อง");
    const { page, pageSize, search, action, entityType, actorUserId, from, to } =
      parsed.data;
    const where = {
      ...(action ? { action } : {}),
      ...(entityType ? { entityType } : {}),
      ...(actorUserId ? { actorUserId } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {})
            }
          }
        : {}),
      ...(search
        ? {
            OR: [
              { action: { contains: search, mode: "insensitive" as const } },
              { entityType: { contains: search, mode: "insensitive" as const } },
              { entityId: { contains: search, mode: "insensitive" as const } }
            ]
          }
        : {})
    };
    const [total, logs, actions, entityTypes] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          actorUserId: true,
          action: true,
          entityType: true,
          entityId: true,
          metadataJson: true,
          ipHash: true,
          userAgent: true,
          createdAt: true
        }
      }),
      this.prisma.auditLog.findMany({
        distinct: ["action"],
        orderBy: { action: "asc" },
        select: { action: true }
      }),
      this.prisma.auditLog.findMany({
        distinct: ["entityType"],
        orderBy: { entityType: "asc" },
        select: { entityType: true }
      })
    ]);
    const actorIds = [
      ...new Set(logs.map(log => log.actorUserId).filter((id): id is string => Boolean(id)))
    ];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, email: true }
        })
      : [];
    const actorMap = new Map(actors.map(actor => [actor.id, actor]));
    return {
      data: logs.map(log => ({
        ...log,
        actor: log.actorUserId ? actorMap.get(log.actorUserId) || null : null,
        ipHash:
          request.auth.user.role === "SYSTEM" && log.ipHash
            ? `${log.ipHash.slice(0, 12)}…`
            : null,
        userAgent:
          request.auth.user.role === "SYSTEM" ? log.userAgent : null
      })),
      filters: {
        actions: actions.map(item => item.action),
        entityTypes: entityTypes.map(item => item.entityType)
      },
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      }
    };
  }
}
