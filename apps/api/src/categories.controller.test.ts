import { ConflictException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { AdminRequest } from "./admin-auth.guard";
import { CategoriesController } from "./categories.controller";
import { PrismaService } from "./prisma.service";

function requestFor(role: Role): AdminRequest {
  return {
    auth: {
      sessionId: "session-test",
      user: {
        id: "actor-test",
        email: "actor@example.test",
        name: "Actor",
        role
      }
    },
    headers: {}
  } as unknown as AdminRequest;
}

describe("CategoriesController STAFF permissions", () => {
  it("allows STAFF to create a category and records the actor", async () => {
    const createCategory = vi.fn().mockResolvedValue({
      id: "category-test",
      name: "Highlights",
      slug: "highlights",
      description: null,
      active: true
    });
    const createAuditLog = vi.fn().mockResolvedValue({});
    const prisma = {
      category: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      $transaction: vi.fn(async (operation: (transaction: unknown) => unknown) =>
        operation({
          category: { create: createCategory },
          auditLog: { create: createAuditLog }
        })
      )
    } as unknown as PrismaService;
    const controller = new CategoriesController(prisma);

    const result = await controller.create(requestFor(Role.STAFF), {
      name: "Highlights"
    });

    expect(result.category).toMatchObject({
      name: "Highlights",
      slug: "highlights"
    });
    expect(createAuditLog).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "actor-test",
        action: "CATEGORY_CREATED"
      })
    });
  });

  it("still prevents STAFF from editing categories", async () => {
    const controller = new CategoriesController({} as PrismaService);

    await expect(
      controller.update(requestFor(Role.STAFF), "category-test", {
        name: "Changed"
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("still prevents STAFF from deleting categories", async () => {
    const controller = new CategoriesController({} as PrismaService);

    await expect(
      controller.remove(requestFor(Role.STAFF), "category-test")
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
