import { ForbiddenException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { AdminRequest } from "./admin-auth.guard";
import { PrismaService } from "./prisma.service";
import { UsersController } from "./users.controller";

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

describe("UsersController role boundaries", () => {
  it("forces ADMIN list queries to STAFF even when role=SYSTEM is requested", async () => {
    let countWhere: unknown;
    let findWhere: unknown;
    const prisma = {
      user: {
        count: vi.fn(({ where }) => {
          countWhere = where;
          return Promise.resolve(0);
        }),
        findMany: vi.fn(({ where }) => {
          findWhere = where;
          return Promise.resolve([]);
        })
      },
      $transaction: vi.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations)
      )
    } as unknown as PrismaService;
    const controller = new UsersController(prisma);

    await controller.list(requestFor(Role.ADMIN), {
      role: Role.SYSTEM,
      page: "1",
      pageSize: "20"
    });

    expect(countWhere).toMatchObject({ role: Role.STAFF });
    expect(findWhere).toMatchObject({ role: Role.STAFF });
  });

  it("rejects STAFF access to the user directory", async () => {
    const controller = new UsersController({} as PrismaService);

    await expect(
      controller.list(requestFor(Role.STAFF), {})
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("prevents ADMIN from creating privileged accounts", async () => {
    const controller = new UsersController({} as PrismaService);

    await expect(
      controller.create(requestFor(Role.ADMIN), {
        email: "new-admin@example.test",
        name: "New Admin",
        password: "Safe-Password-123",
        role: Role.ADMIN,
        active: true
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
