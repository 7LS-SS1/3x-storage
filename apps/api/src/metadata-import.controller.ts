import { BadRequestException, Body, CallHandler, CanActivate, ConflictException, Controller, ExecutionContext, ForbiddenException, Get, Injectable, NestInterceptor, NotFoundException, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import type { Response } from "express";
import { FileInterceptor, NoFilesInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import { AdminSessionGuard, CsrfGuard, type AdminRequest } from "./admin-auth.guard";
import { MAX_METADATA_BYTES } from "./metadata-import.parser";
import { MetadataImportService } from "./metadata-import.service";

@Injectable()
export class MetadataAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const role = context.switchToHttp().getRequest<AdminRequest>().auth?.user.role;
    if (role !== "ADMIN" && role !== "SYSTEM") throw new ForbiddenException("เฉพาะผู้ดูแลระบบเท่านั้น");
    return true;
  }
}
const applySchema = z.object({ confirm: z.literal(true), items: z.array(z.object({ rowId: z.string().min(1).max(128), token: z.string().uuid() }).strict()).min(1).max(2) }).strict();
function pageNumber(value: unknown) { const result = z.coerce.number().int().min(1).max(100000).default(1).safeParse(value); if (!result.success) throw new BadRequestException("หน้าไม่ถูกต้อง"); return result.data; }

@Injectable()
class MetadataPrivateResponse implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context.switchToHttp().getResponse<Response>().setHeader("Cache-Control", "private, no-store, max-age=0");
    return next.handle();
  }
}

@Controller("metadata-import")
@UseGuards(AdminSessionGuard, MetadataAdminGuard, CsrfGuard)
@UseInterceptors(MetadataPrivateResponse)
export class MetadataImportController {
  constructor(private readonly service: MetadataImportService) {}
  @Post("batches")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_METADATA_BYTES, files: 1 } }))
  async upload(@Req() req: AdminRequest, @UploadedFile() file?: { buffer: Buffer; originalname: string }) {
    if (!file) throw new BadRequestException("เลือกไฟล์ JSON/CSV");
    return { batch: await this.service.stage(req.auth.user, file) };
  }
  @Get("batches") async batches() { return { batches: await this.service.batches() }; }
  @Get("batches/:id") async batch(@Param("id") id: string, @Query("page") page?: string) { return this.service.batch(id, pageNumber(page)); }
  @Get("rows/:id") async row(@Param("id") id: string) { return this.service.detail(id); }
  @Get("rows/:id/candidates") async candidates(@Param("id") id: string) { return this.service.candidates(id); }
  @Get("targets") async targets(@Query("id") id: string) { if (!id?.trim() || id.length > 128) throw new BadRequestException("กรอก Video ID หรือ publicId ที่ต้องการค้นหา"); return { videos: await this.service.targets(id.trim()) }; }
  @Post("rows/:id/preview")
  @UseInterceptors(NoFilesInterceptor({ limits: { fieldSize: 1024 * 1024, fields: 1 } }))
  async preview(@Req() req: AdminRequest, @Param("id") id: string, @Body() body: unknown) {
    if (body && typeof body === "object" && "payload" in body && Object.keys(body).length === 1) {
      try { body = JSON.parse(String(body.payload)); } catch { throw new BadRequestException("ข้อมูลตรวจสอบไม่ถูกต้อง"); }
    }
    return this.service.preview(req.auth.user, id, body);
  }
  @Post("apply") async apply(@Req() req: AdminRequest, @Body() body: unknown) {
    const parsed = applySchema.safeParse(body);
    if (!parsed.success || new Set(parsed.data.items.map(i => i.rowId)).size !== parsed.data.items.length) throw new BadRequestException("ต้องยืนยันครั้งละ 1–2 รายการที่ไม่ซ้ำ");
    const results = [];
    // Independent transaction per row: a failed second row never undoes a successful first row.
    for (const item of parsed.data.items) {
      try { results.push({ ...await this.service.applyOne(req.auth.user, item.rowId, item.token), success: true }); }
      catch (error) { results.push({ rowId: item.rowId, success: false, error: error instanceof ConflictException || error instanceof NotFoundException ? error.message : "บันทึกไม่สำเร็จ รายการนี้ถูกย้อน transaction แล้ว กรุณาตรวจใหม่" }); }
    }
    return { results };
  }
  @Get("history") async history(@Query("page") page?: string) { return this.service.history(pageNumber(page)); }
  @Post("history/:id/rollback") async rollback(@Req() req: AdminRequest, @Param("id") id: string, @Body() body: unknown) {
    if (!z.object({ confirm: z.literal(true) }).strict().safeParse(body).success) throw new BadRequestException("ต้องยืนยันก่อนย้อนคืน");
    return this.service.rollback(req.auth.user, id);
  }
}
