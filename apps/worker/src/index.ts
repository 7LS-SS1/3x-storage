import "./load-env.js";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { spawn } from "node:child_process";
import {
  closeGoogleDriveImportResources,
  createGoogleDriveImportWorker
} from "./google-drive-import-worker.js";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
const worker = new Worker("media-processing", async job => {
  const { inputPath, outputPath, posterPath } = job.data as { inputPath: string; outputPath: string; posterPath: string };
  await run("ffprobe", ["-v","error","-show_format","-show_streams","-of","json",inputPath]);
  await run("ffmpeg", ["-y","-i",inputPath,"-c:v","libx264","-preset",process.env.MEDIA_VIDEO_PRESET??"medium","-crf",process.env.MEDIA_VIDEO_CRF??"23","-c:a","aac","-b:a",process.env.MEDIA_AUDIO_BITRATE??"128k","-movflags","+faststart",outputPath]);
  await run("ffmpeg", ["-y","-ss","00:00:03","-i",outputPath,"-frames:v","1","-q:v","2",posterPath]);
}, { connection, concurrency: 2 });
const googleDriveImportWorker = createGoogleDriveImportWorker(connection);
async function shutdown() {
  await Promise.all([worker.close(), googleDriveImportWorker.close()]);
  await closeGoogleDriveImportResources();
  await connection.quit();
}
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
