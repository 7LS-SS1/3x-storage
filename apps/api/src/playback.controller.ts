import { Body, Controller, ForbiddenException, Headers, Post, Res, ServiceUnavailableException } from "@nestjs/common";
import type { Response } from "express";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Throttle } from "@nestjs/throttler";
import { domainMatches, normalizeDomain, signMedia } from "@video/shared";
import { PrismaService } from "./prisma.service";

const authorizeSchema = z.object({
  videoPublicId: z.string().min(10).max(128),
  fileId: z.string().min(10).max(128)
}).strict();
const refreshSchema = z.object({
  playbackSessionId: z.string().uuid(),
  eventToken: z.string().regex(/^[a-f0-9]{64}$/i)
}).strict();
const eventSchema = z.object({
  playbackSessionId: z.string().uuid(),
  eventType: z.literal("play_started"),
  continuousSeconds: z.number().min(3).max(86_400),
  eventToken: z.string().regex(/^[a-f0-9]{64}$/i)
}).strict();

function requiredSecret(name: "MEDIA_SIGNING_SECRET" | "IP_HASH_SALT") {
  const value = process.env[name];
  if (!value || value.length < 32 || value.startsWith("replace-with")) throw new ServiceUnavailableException("ระบบยังไม่ได้ตั้งค่าความปลอดภัย");
  return value;
}

function hmac(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeHexEqual(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function playbackTtlSeconds() {
  return Math.min(Math.max(Number(process.env.MEDIA_URL_TTL_SECONDS || 600), 300), 900);
}

type PlayableFile = {
  id: string;
  storageKey: string;
  role: string;
  mimeType?: string;
};

function preferredFile(files: PlayableFile[]) {
  return files.find(file => file.role === "HLS_MANIFEST") ?? files.find(file => file.role === "PLAYBACK") ?? files.find(file => file.role === "ORIGINAL");
}

function playbackGrant(input: {
  videoPublicId: string;
  fileId: string;
  storageKey: string;
  sessionId: string;
  expires: number;
}) {
  const mediaSecret = requiredSecret("MEDIA_SIGNING_SECRET");
  const mediaBaseUrl = process.env.MEDIA_URL;
  if (!mediaBaseUrl) {
    throw new ServiceUnavailableException("ระบบส่งมอบวิดีโอยังไม่พร้อมใช้งาน");
  }
  let base: URL;
  try {
    base = new URL(mediaBaseUrl);
  } catch {
    throw new ServiceUnavailableException("ระบบส่งมอบวิดีโอยังไม่พร้อมใช้งาน");
  }
  if (process.env.NODE_ENV === "production" && base.protocol !== "https:") {
    throw new ServiceUnavailableException("ระบบส่งมอบวิดีโอยังไม่พร้อมใช้งาน");
  }

  const claims = {
    path: input.storageKey,
    expires: input.expires,
    sessionId: input.sessionId,
    videoId: input.videoPublicId,
    fileId: input.fileId
  };
  const signature = signMedia(claims, mediaSecret);
  const mediaUrl = new URL(
    input.storageKey.split("/").map(encodeURIComponent).join("/"),
    `${base.toString().replace(/\/?$/, "/")}`
  );
  Object.entries({
    expires: String(input.expires),
    sessionId: input.sessionId,
    videoId: input.videoPublicId,
    fileId: input.fileId,
    signature
  }).forEach(([key, value]) => mediaUrl.searchParams.set(key, value));
  const eventToken = hmac(
    ["play_event", input.sessionId, input.videoPublicId, input.expires].join("\n"),
    mediaSecret
  );
  return { mediaUrl: mediaUrl.toString(), eventToken };
}

function refererHost(referer: string | undefined) {
  if (!referer) throw new ForbiddenException("โดเมนนี้ไม่ได้รับอนุญาตให้เล่นวิดีโอ");
  try {
    const url = new URL(referer);
    if (url.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("HTTPS_REQUIRED");
    return normalizeDomain(url.hostname);
  } catch {
    throw new ForbiddenException("ไม่สามารถตรวจสอบโดเมนต้นทางได้");
  }
}

@Controller("playback")
export class PlaybackController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("authorize")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async authorize(
    @Headers("referer") referer: string | undefined,
    @Body() untrustedBody: unknown,
    @Res({ passthrough: true }) response: Response
  ) {
    const parsed = authorizeSchema.safeParse(untrustedBody);
    if (!parsed.success) throw new ForbiddenException("คำขอรับชมไม่ถูกต้อง");
    const host = refererHost(referer);
    const [systemConfig, video] = await Promise.all([
      this.prisma.systemConfig.findUnique({
        where: { id: 1 },
        select: { allowAllDomains: true }
      }),
      this.prisma.video.findFirst({
        where: {
          publicId: parsed.data.videoPublicId,
          status: { in: ["UPLOADED", "READY"] },
          deletedAt: null,
          files: {
            some: {
              id: parsed.data.fileId,
              role: { in: ["HLS_MANIFEST", "PLAYBACK", "ORIGINAL"] }
            }
          }
        },
        select: {
          id: true,
          publicId: true,
          posterKey: true,
          files: {
            where: {
              id: parsed.data.fileId,
              role: { in: ["HLS_MANIFEST", "PLAYBACK", "ORIGINAL"] }
            },
            select: { id: true, storageKey: true, role: true, mimeType: true },
            take: 1
          },
          allowedDomains: {
            where: { allowedDomain: { active: true } },
            select: { allowedDomain: { select: { id: true, hostname: true, includeSubdomains: true } } }
          }
        }
      })
    ]);
    const allowAllDomains = systemConfig?.allowAllDomains ?? false;
    const match = video?.allowedDomains.find(item =>
      domainMatches(host, item.allowedDomain.hostname, item.allowedDomain.includeSubdomains)
    );
    const file = video ? preferredFile(video.files) : undefined;
    if (!video || (!allowAllDomains && !match) || !file) {
      throw new ForbiddenException("โดเมนนี้ไม่ได้รับอนุญาตให้เล่นวิดีโอ");
    }

    const expires = Math.floor(Date.now() / 1000) + playbackTtlSeconds();
    const sessionId = randomUUID();
    const grant = playbackGrant({
      videoPublicId: video.publicId,
      fileId: file.id,
      storageKey: file.storageKey,
      sessionId,
      expires
    });
    const posterUrl = video.posterKey ? playbackGrant({ videoPublicId: video.publicId, fileId: file.id, storageKey: video.posterKey, sessionId, expires }).mediaUrl : null;

    await this.prisma.playbackSession.create({
      data: {
        id: sessionId,
        videoId: video.id,
        allowedDomainId: match?.allowedDomain.id ?? null,
        expiresAt: new Date(expires * 1000)
      }
    });
    response.setHeader("Content-Security-Policy", `frame-ancestors https://${host}`);
    response.setHeader("Cache-Control", "no-store");
    return { playbackSessionId: sessionId, expires, mediaType: file.mimeType, posterUrl, ...grant };
  }

  @Post("refresh")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Body() untrustedBody: unknown,
    @Res({ passthrough: true }) response: Response
  ) {
    const parsed = refreshSchema.safeParse(untrustedBody);
    if (!parsed.success) {
      throw new ForbiddenException("คำขอต่ออายุสิทธิ์รับชมไม่ถูกต้อง");
    }
    const [systemConfig, session] = await Promise.all([
      this.prisma.systemConfig.findUnique({
        where: { id: 1 },
        select: { allowAllDomains: true }
      }),
      this.prisma.playbackSession.findUnique({
        where: { id: parsed.data.playbackSessionId },
        select: {
          id: true,
          expiresAt: true,
          createdAt: true,
          allowedDomain: { select: { active: true } },
          video: {
            select: {
              publicId: true,
              posterKey: true,
              status: true,
              deletedAt: true,
              files: {
                where: { role: { in: ["HLS_MANIFEST", "PLAYBACK", "ORIGINAL"] } },
                orderBy: { createdAt: "desc" },
                select: { id: true, storageKey: true, role: true, mimeType: true }
              }
            }
          }
        }
      })
    ]);
    const previousExpires = session
      ? Math.floor(session.expiresAt.getTime() / 1000)
      : 0;
    const expected = session
      ? hmac(
          ["play_event", session.id, session.video.publicId, previousExpires].join("\n"),
          requiredSecret("MEDIA_SIGNING_SECRET")
        )
      : "";
    const maximumSessionAgeMs = 8 * 60 * 60 * 1000;
    const file = session ? preferredFile(session.video.files) : undefined;
    if (
      !session ||
      !safeHexEqual(parsed.data.eventToken, expected) ||
      Date.now() - session.createdAt.getTime() > maximumSessionAgeMs ||
      (!(systemConfig?.allowAllDomains ?? false) && !session.allowedDomain?.active) ||
      !["UPLOADED", "READY"].includes(session.video.status) ||
      session.video.deletedAt ||
      !file
    ) {
      throw new ForbiddenException("สิทธิ์รับชมหมดอายุ กรุณาโหลดหน้าใหม่");
    }

    const expires = Math.floor(Date.now() / 1000) + playbackTtlSeconds();
    const grant = playbackGrant({
      videoPublicId: session.video.publicId,
      fileId: file.id,
      storageKey: file.storageKey,
      sessionId: session.id,
      expires
    });
    const posterUrl = session.video.posterKey ? playbackGrant({ videoPublicId: session.video.publicId, fileId: file.id, storageKey: session.video.posterKey, sessionId: session.id, expires }).mediaUrl : null;
    await this.prisma.playbackSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(expires * 1000) }
    });
    response.setHeader("Cache-Control", "no-store");
    return { playbackSessionId: session.id, expires, mediaType: file.mimeType, posterUrl, ...grant };
  }

  @Post("events")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async event(
    @Headers("x-forwarded-for") forwardedFor: string | undefined,
    @Body() untrustedBody: unknown
  ) {
    const parsed = eventSchema.safeParse(untrustedBody);
    if (!parsed.success) throw new ForbiddenException("เหตุการณ์เล่นวิดีโอไม่ถูกต้อง");
    const session = await this.prisma.playbackSession.findUnique({
      where: { id: parsed.data.playbackSessionId },
      select: { id: true, expiresAt: true, videoId: true, video: { select: { publicId: true } } }
    });
    if (!session || session.expiresAt <= new Date()) throw new ForbiddenException("สิทธิ์รับชมหมดอายุ");
    const expires = Math.floor(session.expiresAt.getTime() / 1000);
    const expected = hmac(["play_event", session.id, session.video.publicId, expires].join("\n"), requiredSecret("MEDIA_SIGNING_SECRET"));
    if (!safeHexEqual(parsed.data.eventToken, expected)) throw new ForbiddenException("เหตุการณ์เล่นวิดีโอไม่ถูกต้อง");
    const ipHash = process.env.TRUST_PROXY === "true" && forwardedFor
      ? hmac(forwardedFor.split(",")[0]!.trim(), requiredSecret("IP_HASH_SALT"))
      : null;

    await this.prisma.$transaction(async transaction => {
      const inserted = await transaction.playEvent.createMany({
        data: [{ playbackSessionId: session.id, videoId: session.videoId, eventType: "play_started", ipHash }],
        skipDuplicates: true
      });
      if (inserted.count === 1) {
        await transaction.video.update({ where: { id: session.videoId }, data: { playCount: { increment: 1 } } });
      }
    });
    return { accepted: true, idempotent: true };
  }
}
