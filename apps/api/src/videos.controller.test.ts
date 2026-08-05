import { Role } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminRequest } from "./admin-auth.guard";
import { PrismaService } from "./prisma.service";
import { StorageService } from "./storage.service";
import { VideosController } from "./videos.controller";

function requestFor(role: Role): AdminRequest {
  return {
    auth: {
      sessionId: "session-test",
      user: {
        id: "staff-test",
        email: "staff@example.test",
        name: "Staff",
        role
      }
    },
    headers: {}
  } as unknown as AdminRequest;
}

function controllerForDeletion() {
  const updateVideo = vi.fn().mockResolvedValue({});
  const createAuditLog = vi.fn().mockResolvedValue({});
  const prisma = {
    video: {
      findFirst: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({
          id: where.id,
          files: [],
          uploadSessions: []
        })
      ),
      update: updateVideo
    },
    uploadSession: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 })
    },
    auditLog: {
      create: createAuditLog
    },
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations)
    )
  } as unknown as PrismaService;
  const storage = {
    abortMultipartUpload: vi.fn().mockResolvedValue(undefined),
    deleteObject: vi.fn().mockResolvedValue(undefined)
  } as unknown as StorageService;
  return {
    controller: new VideosController(prisma, storage),
    updateVideo,
    createAuditLog
  };
}

describe("VideosController STAFF deletion permissions", () => {
  it("allows STAFF to delete one video and audits the actor", async () => {
    const { controller, updateVideo, createAuditLog } = controllerForDeletion();

    await expect(
      controller.remove(requestFor(Role.STAFF), "video-test")
    ).resolves.toEqual({ deleted: true });

    expect(updateVideo).toHaveBeenCalledWith({
      where: { id: "video-test" },
      data: expect.objectContaining({ status: "DELETED" })
    });
    expect(createAuditLog).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "staff-test",
        action: "VIDEO_DELETED"
      })
    });
  });

  it("allows STAFF to delete multiple videos", async () => {
    const { controller } = controllerForDeletion();

    await expect(
      controller.bulkDelete(requestFor(Role.STAFF), {
        videoIds: ["video-one", "video-two"]
      })
    ).resolves.toMatchObject({
      requestedCount: 2,
      successCount: 2,
      failureCount: 0
    });
  });
});

describe("VideosController poster URLs", () => {
  const previousPlayerUrl = process.env.PLAYER_URL;

  beforeEach(() => {
    process.env.PLAYER_URL = "https://player.example.test";
  });

  afterEach(() => {
    if (previousPlayerUrl === undefined) delete process.env.PLAYER_URL;
    else process.env.PLAYER_URL = previousPlayerUrl;
  });

  it("signs available covers for the video library and preserves the empty state", async () => {
    const baseVideo = {
      publicId: "public-video",
      title: "วิดีโอทดสอบ",
      status: "READY" as const,
      durationSeconds: 30,
      playCount: 0n,
      fileSize: 1024n,
      mimeType: "video/mp4",
      originalFilename: "video.mp4",
      uploadedAt: new Date("2026-08-04T00:00:00.000Z"),
      createdAt: new Date("2026-08-04T00:00:00.000Z"),
      processingError: null,
      category: null,
      allowedDomains: [],
      uploadedBy: { id: "user-test", name: "Tester", email: "test@example.test" },
      files: [{ id: "file-test", role: "PLAYBACK", mimeType: "video/mp4" }]
    };
    const prisma = {
      video: {
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue([
          { ...baseVideo, id: "video-with-cover", posterKey: "images/video-with-cover/poster.webp" },
          { ...baseVideo, id: "video-without-cover", posterKey: null }
        ])
      },
      $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations))
    } as unknown as PrismaService;
    const createReadUrl = vi.fn().mockResolvedValue("https://storage.example.test/signed-cover");
    const storage = { createReadUrl } as unknown as StorageService;
    const controller = new VideosController(prisma, storage);

    const result = await controller.list({});

    expect(createReadUrl).toHaveBeenCalledOnce();
    expect(createReadUrl).toHaveBeenCalledWith("images/video-with-cover/poster.webp", 600);
    expect(result.data).toEqual([
      expect.objectContaining({
        id: "video-with-cover",
        posterAvailable: true,
        posterUrl: "https://storage.example.test/signed-cover",
        thumbnailUrl: "https://player.example.test/backend/playback/poster/public-video"
      }),
      expect.objectContaining({
        id: "video-without-cover",
        posterAvailable: false,
        posterUrl: null,
        thumbnailUrl: null
      })
    ]);
  });
});

describe("VideosController export", () => {
  it("returns every requested video with its public embed URL", async () => {
    const previousPlayerUrl = process.env.PLAYER_URL;
    process.env.PLAYER_URL = "https://player.example.test";
    try {
      const findMany = vi.fn().mockResolvedValue([
        {
          title: "วิดีโอหนึ่ง",
          publicId: "public-video-one",
          posterKey: "images/video-one/poster.webp",
          category: { name: "บทเรียน" }
        },
        {
          title: "วิดีโอสอง",
          publicId: "public-video-two",
          posterKey: null,
          category: null
        }
      ]);
      const prisma = { video: { findMany } } as unknown as PrismaService;
      const controller = new VideosController(prisma, {} as StorageService);

      await expect(controller.export({
        videoIds: ["video-one", "video-two"]
      })).resolves.toEqual({
        videos: [
          {
            title: "วิดีโอหนึ่ง",
            category: "บทเรียน",
            embedUrl: "https://player.example.test/embed/public-video-one",
            thumbnailUrl: "https://player.example.test/backend/playback/poster/public-video-one"
          },
          {
            title: "วิดีโอสอง",
            category: "",
            embedUrl: "https://player.example.test/embed/public-video-two",
            thumbnailUrl: ""
          }
        ]
      });
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { deletedAt: null, id: { in: ["video-one", "video-two"] } },
        select: {
          title: true,
          publicId: true,
          posterKey: true,
          category: { select: { name: true } }
        }
      }));
    } finally {
      if (previousPlayerUrl === undefined) delete process.env.PLAYER_URL;
      else process.env.PLAYER_URL = previousPlayerUrl;
    }
  });
});
