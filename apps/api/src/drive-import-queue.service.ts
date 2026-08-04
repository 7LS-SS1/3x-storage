import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";

@Injectable()
export class DriveImportQueueService implements OnModuleDestroy {
  private readonly connection = new IORedis(
    process.env.NODE_ENV === "production"
      ? process.env.REDIS_URL || "redis://localhost:6379"
      : process.env.LOCAL_REDIS_URL || "redis://localhost:6379",
    {
      maxRetriesPerRequest: null,
      enableReadyCheck: true
    }
  );

  private readonly queue = new Queue("google-drive-import", {
    connection: this.connection
  });

  async enqueue(importId: string) {
    const existing = await this.queue.getJob(importId);
    if (existing) {
      const state = await existing.getState();
      if (["failed", "completed"].includes(state)) await existing.remove();
    }
    await this.queue.add(
      "transfer",
      { importId },
      {
        jobId: importId,
        attempts: 4,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: true
      }
    );
  }

  async removeWaiting(importId: string) {
    const job = await this.queue.getJob(importId);
    if (!job) return;
    const state = await job.getState();
    if (["waiting", "delayed", "paused"].includes(state)) {
      await job.remove();
    }
  }

  async health() {
    return (await this.connection.ping()) === "PONG";
  }

  async onModuleDestroy() {
    await this.queue.close();
    await this.connection.quit();
  }
}
