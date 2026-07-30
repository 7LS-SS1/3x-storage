import { Role } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
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
