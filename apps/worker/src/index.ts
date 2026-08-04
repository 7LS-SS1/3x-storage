import "./load-env.js";
import { Queue } from "bullmq";
import {
  closeGoogleDriveImportResources,
  createGoogleDriveImportWorker
} from "./google-drive-import-worker.js";
import { closeMediaProcessingResources, createMediaProcessingWorker } from "./media-processing-worker.js";
import { createRedisConnection } from "./redis-connection.js";

const connection = createRedisConnection();
const worker = createMediaProcessingWorker(connection);
const googleDriveImportWorker = createGoogleDriveImportWorker(connection);
const mediaQueue = new Queue("media-processing", { connection });
googleDriveImportWorker.on("completed", async job => {
  const result = job.returnvalue as { videoId?: string } | undefined;
  if (result?.videoId) {
    await mediaQueue.add("transcode-hls", { videoId: result.videoId }, { jobId: `video-${result.videoId}`, attempts: 3, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: true, removeOnFail: 100 });
  }
});
async function shutdown() {
  await Promise.all([worker.close(), googleDriveImportWorker.close(), mediaQueue.close()]);
  await closeGoogleDriveImportResources();
  await closeMediaProcessingResources();
  await connection.quit();
}
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
