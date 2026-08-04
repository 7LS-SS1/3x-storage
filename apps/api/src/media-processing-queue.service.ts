import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { createRedisConnection } from "./redis-connection";

@Injectable()
export class MediaProcessingQueueService implements OnModuleDestroy {
  private readonly connection = createRedisConnection();
  private readonly queue = new Queue("media-processing", { connection: this.connection });

  async enqueue(videoId: string) {
    const jobId = `video-${videoId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (["failed", "completed"].includes(state)) await existing.remove();
      else return;
    }
    await this.queue.add("transcode-hls", { videoId }, {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: true,
      removeOnFail: 100
    });
  }

  async health() {
    return (await this.connection.ping()) === "PONG";
  }

  async onModuleDestroy() {
    await this.queue.close();
    await this.connection.quit();
  }
}
