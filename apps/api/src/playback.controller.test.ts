import { ForbiddenException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackController } from "./playback.controller";
import { PrismaService } from "./prisma.service";

const mediaSecret = "test-media-secret-with-at-least-32-characters";

function eventToken(sessionId: string, videoPublicId: string, expires: number) {
  return createHmac("sha256", mediaSecret)
    .update(["play_event", sessionId, videoPublicId, expires].join("\n"))
    .digest("hex");
}

describe("PlaybackController authorization refresh", () => {
  beforeEach(() => {
    process.env.MEDIA_SIGNING_SECRET = mediaSecret;
    process.env.MEDIA_URL = "https://media.example.test";
    process.env.MEDIA_URL_TTL_SECONDS = "600";
  });

  afterEach(() => {
    delete process.env.MEDIA_SIGNING_SECRET;
    delete process.env.MEDIA_URL;
    delete process.env.MEDIA_URL_TTL_SECONDS;
  });

  it("authorizes an uploaded original when no playback rendition exists yet", async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = {
      video: {
        findFirst: vi.fn().mockResolvedValue({
          id: "video-database-id",
          publicId: "video-public-test",
          files: [{
            id: "file-original-test",
            storageKey: "videos/original/video-test.mp4",
            role: "ORIGINAL"
          }],
          allowedDomains: [{
            allowedDomain: {
              id: "allowed-domain-id",
              hostname: "sports.example.test",
              includeSubdomains: false
            }
          }]
        })
      },
      playbackSession: { create }
    } as unknown as PrismaService;
    const controller = new PlaybackController(prisma);
    const setHeader = vi.fn();

    const result = await controller.authorize(
      "https://sports.example.test/watch/123",
      {
        videoPublicId: "video-public-test",
        fileId: "file-original-test"
      },
      { setHeader } as never
    );

    expect(result.mediaUrl).toContain(
      "https://media.example.test/videos/original/video-test.mp4"
    );
    expect(create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        videoId: "video-database-id",
        allowedDomainId: "allowed-domain-id",
        expiresAt: expect.any(Date)
      }
    });
  });

  it("refreshes a valid playback grant and rotates its event token", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const videoPublicId = "video-public-test";
    const previousExpires = Math.floor(Date.now() / 1000) - 30;
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      playbackSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: sessionId,
          expiresAt: new Date(previousExpires * 1000),
          createdAt: new Date(Date.now() - 60_000),
          allowedDomain: { active: true },
          video: {
            publicId: videoPublicId,
            status: "READY",
            deletedAt: null,
            files: [{
              id: "file-playback-test",
              storageKey: "videos/playback/video-test.mp4",
              role: "PLAYBACK"
            }]
          }
        }),
        update
      }
    } as unknown as PrismaService;
    const controller = new PlaybackController(prisma);
    const setHeader = vi.fn();

    const result = await controller.refresh({
      playbackSessionId: sessionId,
      eventToken: eventToken(sessionId, videoPublicId, previousExpires)
    }, { setHeader } as never);

    expect(result.playbackSessionId).toBe(sessionId);
    expect(result.expires).toBeGreaterThan(previousExpires);
    expect(result.eventToken).not.toBe(
      eventToken(sessionId, videoPublicId, previousExpires)
    );
    expect(result.mediaUrl).toContain("https://media.example.test/");
    expect(update).toHaveBeenCalledWith({
      where: { id: sessionId },
      data: { expiresAt: expect.any(Date) }
    });
    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("rejects a forged refresh token", async () => {
    const prisma = {
      playbackSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: "11111111-1111-4111-8111-111111111111",
          expiresAt: new Date(),
          createdAt: new Date(),
          allowedDomain: { active: true },
          video: {
            publicId: "video-public-test",
            status: "READY",
            deletedAt: null,
            files: [{
              id: "file-playback-test",
              storageKey: "videos/playback/video-test.mp4",
              role: "PLAYBACK"
            }]
          }
        })
      }
    } as unknown as PrismaService;
    const controller = new PlaybackController(prisma);

    await expect(controller.refresh({
      playbackSessionId: "11111111-1111-4111-8111-111111111111",
      eventToken: "a".repeat(64)
    }, { setHeader: vi.fn() } as never)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });
});
