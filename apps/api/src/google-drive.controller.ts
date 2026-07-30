import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import {
  AdminSessionGuard,
  CsrfGuard,
  type AdminRequest
} from "./admin-auth.guard";
import { GoogleDriveService } from "./google-drive.service";

const callbackSchema = z
  .object({
    code: z.string().min(1).max(4096),
    state: z.string().min(20).max(512)
  })
  .passthrough();
const importSchema = z
  .object({
    fileIds: z.array(z.string().trim().min(1).max(256)).min(1).max(20),
    categoryId: z.string().trim().min(1).max(128).nullable().optional()
  })
  .strict();

function uploadRedirect(status: "connected" | "error" | "denied") {
  const url = new URL("/upload", process.env.ADMIN_URL || "http://localhost:3000");
  url.searchParams.set("drive", status);
  return url.toString();
}

@Controller("google-drive")
@UseGuards(AdminSessionGuard, CsrfGuard)
export class GoogleDriveController {
  constructor(private readonly googleDrive: GoogleDriveService) {}

  @Get("status")
  status(@Req() request: AdminRequest) {
    return this.googleDrive.status(request.auth.user.id);
  }

  @Get("connect")
  async connect(
    @Req() request: AdminRequest,
    @Res() response: Response
  ) {
    response.redirect(
      await this.googleDrive.authorizationUrl(request.auth.user.id)
    );
  }

  @Get("callback")
  async callback(
    @Req() request: AdminRequest,
    @Query() query: Record<string, unknown>,
    @Res() response: Response
  ) {
    if (query.error === "access_denied") {
      response.redirect(uploadRedirect("denied"));
      return;
    }
    const parsed = callbackSchema.safeParse(query);
    if (!parsed.success) {
      response.redirect(uploadRedirect("error"));
      return;
    }
    try {
      await this.googleDrive.completeAuthorization(
        request.auth.user.id,
        parsed.data.code,
        parsed.data.state
      );
      response.redirect(uploadRedirect("connected"));
    } catch {
      response.redirect(uploadRedirect("error"));
    }
  }

  @Get("picker-token")
  @Header("Cache-Control", "no-store, max-age=0")
  @Header("Pragma", "no-cache")
  pickerToken(@Req() request: AdminRequest) {
    return this.googleDrive.pickerToken(request.auth.user.id);
  }

  @Get("imports")
  listImports(@Req() request: AdminRequest) {
    return this.googleDrive.listImports(request.auth.user.id);
  }

  @Post("imports")
  createImports(
    @Req() request: AdminRequest,
    @Body() body: unknown
  ) {
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        "รายการไฟล์หรือหมวดหมู่สำหรับนำเข้าไม่ถูกต้อง"
      );
    }
    return this.googleDrive.createImports(
      request.auth.user.id,
      [...new Set(parsed.data.fileIds)],
      parsed.data.categoryId
    );
  }

  @Post("imports/:id/retry")
  retry(
    @Req() request: AdminRequest,
    @Param("id") id: string
  ) {
    return this.googleDrive.retryImport(request.auth.user.id, id);
  }

  @Post("imports/:id/cancel")
  cancel(
    @Req() request: AdminRequest,
    @Param("id") id: string
  ) {
    return this.googleDrive.cancelImport(request.auth.user.id, id);
  }

  @Delete("connection")
  disconnect(@Req() request: AdminRequest) {
    return this.googleDrive.disconnect(request.auth.user.id);
  }
}
