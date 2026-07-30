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
  Req,
  UseGuards
} from "@nestjs/common";
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
    name: z.string().trim().min(1).max(100),
    slug: z.string().trim().max(120).optional(),
    description: z.string().trim().max(500).nullable().optional()
  })
  .strict();

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    slug: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    active: z.boolean().optional()
  })
  .strict()
  .refine(value => Object.keys(value).length > 0);

function slugify(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

@Controller("categories")
@UseGuards(AdminSessionGuard, CsrfGuard)
export class CategoriesController {
  constructor(private readonly prisma: PrismaService) {}

  private assertManager(request: AdminRequest) {
    if (!canManageAllVideos(request.auth.user.role)) {
      throw new ConflictException("บัญชี STAFF ไม่มีสิทธิ์จัดการหมวดหมู่");
    }
  }

  @Get()
  async list() {
    const categories = await this.prisma.category.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        active: true,
        _count: { select: { videos: { where: { deletedAt: null } } } }
      }
    });
    return {
      categories: categories.map(category => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        active: category.active,
        videoCount: category._count.videos
      }))
    };
  }

  @Post()
  async create(@Req() request: AdminRequest, @Body() body: unknown) {
    this.assertManager(request);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ข้อมูลหมวดหมู่ไม่ถูกต้อง");
    const slug = slugify(parsed.data.slug || parsed.data.name);
    if (!slug) throw new BadRequestException("ไม่สามารถสร้าง slug จากชื่อหมวดหมู่ได้");
    const duplicate = await this.prisma.category.findFirst({
      where: {
        OR: [
          { name: { equals: parsed.data.name, mode: "insensitive" } },
          { slug }
        ]
      },
      select: { id: true }
    });
    if (duplicate) throw new ConflictException("ชื่อหรือ slug ของหมวดหมู่นี้มีอยู่แล้ว");
    const category = await this.prisma.$transaction(async transaction => {
      const created = await transaction.category.create({
        data: {
          name: parsed.data.name,
          slug,
          description: parsed.data.description || null
        }
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: request.auth.user.id,
          action: "CATEGORY_CREATED",
          entityType: "Category",
          entityId: created.id,
          metadataJson: { name: created.name, slug: created.slug }
        }
      });
      return created;
    });
    return { category };
  }

  @Patch(":id")
  async update(
    @Req() request: AdminRequest,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    this.assertManager(request);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("ข้อมูลหมวดหมู่ไม่ถูกต้อง");
    const current = await this.prisma.category.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("ไม่พบหมวดหมู่");
    const nextName = parsed.data.name || current.name;
    const nextSlug =
      parsed.data.slug !== undefined
        ? slugify(parsed.data.slug)
        : parsed.data.name !== undefined
          ? slugify(nextName)
          : current.slug;
    if (!nextSlug) throw new BadRequestException("slug ไม่ถูกต้อง");
    const duplicate = await this.prisma.category.findFirst({
      where: {
        id: { not: id },
        OR: [
          { name: { equals: nextName, mode: "insensitive" } },
          { slug: nextSlug }
        ]
      },
      select: { id: true }
    });
    if (duplicate) throw new ConflictException("ชื่อหรือ slug ของหมวดหมู่นี้มีอยู่แล้ว");
    const category = await this.prisma.$transaction(async transaction => {
      const updated = await transaction.category.update({
        where: { id },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(nextSlug !== current.slug ? { slug: nextSlug } : {}),
          ...(parsed.data.description !== undefined
            ? { description: parsed.data.description }
            : {}),
          ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {})
        }
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: request.auth.user.id,
          action: "CATEGORY_UPDATED",
          entityType: "Category",
          entityId: id,
          metadataJson: { fields: Object.keys(parsed.data) }
        }
      });
      return updated;
    });
    return { category };
  }

  @Delete(":id")
  async remove(@Req() request: AdminRequest, @Param("id") id: string) {
    this.assertManager(request);
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true, _count: { select: { videos: true } } }
    });
    if (!category) throw new NotFoundException("ไม่พบหมวดหมู่");
    if (category._count.videos > 0) {
      throw new ConflictException("หมวดหมู่นี้ยังมีวิดีโอใช้งานอยู่");
    }
    await this.prisma.$transaction([
      this.prisma.category.delete({ where: { id } }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: request.auth.user.id,
          action: "CATEGORY_DELETED",
          entityType: "Category",
          entityId: id,
          metadataJson: {}
        }
      })
    ]);
    return { deleted: true };
  }
}
