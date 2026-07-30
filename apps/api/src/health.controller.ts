import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { DriveImportQueueService } from "./drive-import-queue.service";
import { PrismaService } from "./prisma.service";
import { StorageService } from "./storage.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: DriveImportQueueService,
    private readonly storage: StorageService
  ) {}

  @Get("live") live() { return { status: "ok" }; }

  @Get("ready")
  async ready(@Res({ passthrough: true }) response: Response) {
    const [database, redis, storage] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.queue.health().catch(() => false),
      this.storage.health().then(result => result.connected).catch(() => false)
    ]);
    const ready = database && redis && storage;
    response.status(ready ? 200 : 503);
    return {
      status: ready ? "ready" : "not-ready",
      services: {
        database,
        redis,
        storage,
        queue: redis
      }
    };
  }
}
