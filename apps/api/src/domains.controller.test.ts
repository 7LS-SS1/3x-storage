import { Role } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { AdminRequest } from "./admin-auth.guard";
import { DomainsController } from "./domains.controller";
import { PrismaService } from "./prisma.service";

function requestFor(role: Role): AdminRequest {
  return {
    auth: {
      sessionId: "session-test",
      user: {
        id: "admin-test",
        email: "admin@example.test",
        name: "Admin",
        role
      }
    },
    headers: { "user-agent": "vitest" }
  } as unknown as AdminRequest;
}

describe("DomainsController global access policy", () => {
  it("persists and audits allow-all mode", async () => {
    const upsert = vi.fn().mockResolvedValue({
      allowAllDomains: true,
      updatedAt: new Date("2026-08-05T00:00:00.000Z")
    });
    const createAudit = vi.fn().mockResolvedValue({});
    const prisma = {
      $transaction: vi.fn((callback: (transaction: unknown) => unknown) => callback({
        systemConfig: { upsert },
        auditLog: { create: createAudit }
      }))
    } as unknown as PrismaService;
    const controller = new DomainsController(prisma);

    await expect(controller.updateAccessPolicy(requestFor(Role.ADMIN), {
      allowAllDomains: true
    })).resolves.toMatchObject({
      accessPolicy: { allowAllDomains: true }
    });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 },
      update: expect.objectContaining({ allowAllDomains: true })
    }));
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "ALLOW_ALL_DOMAINS_ENABLED" })
    });
  });

  it("rejects STAFF accounts before changing the global policy", async () => {
    const prisma = { $transaction: vi.fn() } as unknown as PrismaService;
    const controller = new DomainsController(prisma);

    await expect(controller.updateAccessPolicy(requestFor(Role.STAFF), {
      allowAllDomains: true
    })).rejects.toThrow("บัญชี STAFF ไม่มีสิทธิ์จัดการโดเมน");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
