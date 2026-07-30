import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import type { Role } from "@prisma/client";
import type { Request } from "express";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { PrismaService } from "./prisma.service";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type AdminRequest = Request & {
  auth: {
    sessionId: string;
    user: { id: string; email: string; name: string; role: Role };
  };
};

function requiredSecret(name: "SESSION_SECRET" | "CSRF_SECRET") {
  const value = process.env[name];
  if (!value || value.length < 32 || value.startsWith("replace-with")) {
    throw new Error(`Missing or insecure required environment variable: ${name}`);
  }
  return value;
}

function cookieName() {
  const configured = process.env.SESSION_COOKIE_NAME?.trim();
  return process.env.NODE_ENV === "production"
    ? configured || "__Host-video_session"
    : configured || "video_session";
}

function csrfCookieName() {
  return process.env.NODE_ENV === "production" ? "__Host-video_csrf" : "video_csrf";
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    const rawValue = pair.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      // Ignore malformed cookie values.
    }
  }
  return cookies;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function keyedHash(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqualHex(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const token = parseCookies(request.headers.cookie).get(cookieName());
    if (!token || !TOKEN_PATTERN.test(token)) {
      throw new UnauthorizedException("กรุณาเข้าสู่ระบบ");
    }

    const now = new Date();
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: {
        user: {
          select: { id: true, email: true, name: true, role: true, active: true }
        }
      }
    });

    if (
      !session ||
      session.revokedAt ||
      !session.user.active ||
      session.expiresAt <= now ||
      session.absoluteExpiresAt <= now
    ) {
      throw new UnauthorizedException("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
    }

    if (session.userAgentHash) {
      const userAgent = request.headers["user-agent"]?.slice(0, 512) || "";
      const currentHash = userAgent
        ? keyedHash(userAgent, requiredSecret("SESSION_SECRET"))
        : "";
      if (!currentHash || !safeEqualHex(currentHash, session.userAgentHash)) {
        await this.prisma.session.update({
          where: { id: session.id },
          data: { revokedAt: now }
        });
        throw new UnauthorizedException("ไม่สามารถยืนยันอุปกรณ์ของเซสชันนี้ได้");
      }
    }

    const idleTtlSeconds = Math.min(
      Math.max(Number(process.env.SESSION_TTL_SECONDS || 3600), 900),
      86_400
    );
    if (session.expiresAt.getTime() - now.getTime() < idleTtlSeconds * 500) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          expiresAt: new Date(
            Math.min(
              session.absoluteExpiresAt.getTime(),
              now.getTime() + idleTtlSeconds * 1000
            )
          ),
          lastSeenAt: now
        }
      });
    }

    request.auth = {
      sessionId: session.id,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: session.user.role
      }
    };
    return true;
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true;

    const origin = request.headers.origin;
    const expectedOrigin = new URL(process.env.ADMIN_URL || "http://localhost:3000").origin;
    if (origin !== expectedOrigin) {
      throw new ForbiddenException("คำขอไม่ได้มาจากหน้าผู้ดูแลระบบ");
    }

    const cookies = parseCookies(request.headers.cookie);
    const headerToken = request.headers["x-csrf-token"];
    const cookieToken = cookies.get(csrfCookieName());
    if (
      typeof headerToken !== "string" ||
      !cookieToken ||
      !TOKEN_PATTERN.test(headerToken) ||
      headerToken !== cookieToken
    ) {
      throw new ForbiddenException("โทเค็นความปลอดภัยไม่ถูกต้อง");
    }

    const session = await this.prisma.session.findUnique({
      where: { id: request.auth.sessionId },
      select: { csrfHash: true }
    });
    const actualHash = keyedHash(headerToken, requiredSecret("CSRF_SECRET"));
    if (!session || !safeEqualHex(actualHash, session.csrfHash)) {
      throw new ForbiddenException("โทเค็นความปลอดภัยไม่ถูกต้อง");
    }
    return true;
  }
}

export function canManageAllVideos(role: Role) {
  return role === "SYSTEM" || role === "ADMIN";
}
