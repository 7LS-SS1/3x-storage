import "reflect-metadata";
import { config } from "dotenv";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaService } from "./prisma.service";
import { StorageService } from "./storage.service";
import { MetadataVideoFrames } from "./metadata-video-frames";
import { MetadataVideoJobs } from "./metadata-video-jobs.service";
import { MetadataVideoProcessor } from "./metadata-video-processor";

if (process.env.NODE_ENV !== "production") config({ path: resolve(__dirname, "../../../.env"), quiet: true });
@Module({ providers: [PrismaService, StorageService, MetadataVideoFrames, MetadataVideoJobs, MetadataVideoProcessor] })
class MetadataWorkerModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(MetadataWorkerModule);
  const processor = app.get(MetadataVideoProcessor);
  const stop = () => { processor.stopping = true; };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  let checking = false;
  const heartbeat = setInterval(() => {
    if (checking) return;
    checking = true;
    void app.get(PrismaService).$queryRaw`SELECT 1`
      .then(() => writeFile(resolve(tmpdir(), "metadata-video-heartbeat"), String(Date.now())))
      .catch(() => undefined).finally(() => { checking = false; });
  }, 10_000);
  try { await processor.run(Number(process.env.METADATA_VIDEO_CONCURRENCY || 2)); }
  finally { clearInterval(heartbeat); await app.close(); }
}
void main().catch(() => { console.error("Metadata video worker failed to start"); process.exitCode = 1; });
