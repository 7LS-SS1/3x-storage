import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Prisma, PrismaClient } from "@prisma/client";
import { Worker } from "bullmq";
import type IORedis from "ioredis";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

function required(name: string, value?: string) {
  const result = value?.trim();
  if (!result || result.startsWith("replace-with")) throw new Error(`MISSING_${name}`);
  return result;
}

function storage() {
  const r2 = process.env.STORAGE_DRIVER === "r2";
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const bucket = required(r2 ? "R2_BUCKET" : "S3_BUCKET", r2 ? process.env.R2_BUCKET : process.env.S3_BUCKET);
  const client = new S3Client({
    endpoint: required(r2 ? "R2_S3_ENDPOINT" : "S3_ENDPOINT", r2
      ? process.env.R2_S3_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined)
      : process.env.S3_ENDPOINT),
    region: r2 ? "auto" : process.env.S3_REGION || "auto",
    forcePathStyle: r2 ? false : process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: {
      accessKeyId: required(r2 ? "R2_ACCESS_KEY_ID" : "S3_ACCESS_KEY_ID", r2 ? process.env.R2_ACCESS_KEY_ID : process.env.S3_ACCESS_KEY_ID),
      secretAccessKey: required(r2 ? "R2_SECRET_ACCESS_KEY" : "S3_SECRET_ACCESS_KEY", r2 ? process.env.R2_SECRET_ACCESS_KEY : process.env.S3_SECRET_ACCESS_KEY)
    }
  });
  return { client, bucket };
}

function run(command: string, args: string[], capture = false) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let output = "";
    if (capture) {
      child.stdout?.on("data", chunk => output += chunk);
      child.stderr?.on("data", chunk => output += chunk);
    }
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve(output) : reject(new Error(`${command} exited ${code}: ${output.slice(-1000)}`)));
  });
}

export function createMediaProcessingWorker(connection: IORedis) {
  return new Worker("media-processing", async job => {
    const { videoId } = job.data as { videoId: string };
    const video = await prisma.video.findFirst({
      where: { id: videoId, deletedAt: null },
      select: { id: true, originalKey: true, originalFilename: true, posterKey: true }
    });
    if (!video?.originalKey) throw new Error("VIDEO_ORIGINAL_NOT_FOUND");

    const workDir = await mkdtemp(join(process.env.WORKER_TMP_DIR || tmpdir(), "3x-hls-"));
    const input = join(workDir, `input${extname(video.originalFilename || "") || ".video"}`);
    const manifest = join(workDir, "index.m3u8");
    const poster = join(workDir, "poster.jpg");
    const prefix = `videos/${video.id}/hls`;
    const posterKey = `videos/${video.id}/poster.jpg`;
    const { client, bucket } = storage();
    try {
      await prisma.video.update({ where: { id: video.id }, data: { status: "PROCESSING", processingError: null } });
      const source = await client.send(new GetObjectCommand({ Bucket: bucket, Key: video.originalKey }));
      if (!source.Body) throw new Error("EMPTY_VIDEO_OBJECT");
      await pipeline(Readable.fromWeb(source.Body.transformToWebStream() as never), createWriteStream(input));

      const probe = JSON.parse(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", input], true)) as {
        format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
      };
      const videoStream = probe.streams?.find(stream => stream.codec_type === "video");
      await run("ffmpeg", ["-y", "-i", input,
        "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", process.env.MEDIA_VIDEO_PRESET || "medium",
        "-crf", process.env.MEDIA_VIDEO_CRF || "23", "-pix_fmt", "yuv420p", "-c:a", "aac",
        "-b:a", process.env.MEDIA_AUDIO_BITRATE || "128k", "-ac", "2", "-ar", "48000",
        "-force_key_frames", "expr:gte(t,n_forced*6)", "-hls_time", "6", "-hls_playlist_type", "vod",
        "-hls_flags", "independent_segments", "-hls_segment_filename", join(workDir, "segment-%05d.ts"), manifest]);
      await run("ffmpeg", ["-y", "-ss", process.env.MEDIA_POSTER_TIME || "3", "-i", input, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "2", poster]);

      const outputNames = (await readdir(workDir)).filter(name => name === "index.m3u8" || name.endsWith(".ts"));
      const records: Prisma.VideoFileCreateManyInput[] = [];
      for (const name of outputNames) {
        const path = join(workDir, name);
        const key = `${prefix}/${name}`;
        const size = (await stat(path)).size;
        const manifestFile = name.endsWith(".m3u8");
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: await readFile(path), ContentType: manifestFile ? "application/vnd.apple.mpegurl" : "video/mp2t" }));
        records.push({ id: randomUUID(), videoId: video.id, role: manifestFile ? "HLS_MANIFEST" as const : "HLS_SEGMENT" as const, storageKey: key, filename: name, extension: extname(name), mimeType: manifestFile ? "application/vnd.apple.mpegurl" : "video/mp2t", container: manifestFile ? "hls" : "mpegts", sizeBytes: BigInt(size) });
      }
      const posterSize = (await stat(poster)).size;
      if (!video.posterKey) {
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: posterKey, Body: await readFile(poster), ContentType: "image/jpeg", CacheControl: "private, max-age=300" }));
      }
      await prisma.$transaction(async tx => {
        await tx.videoFile.deleteMany({ where: { videoId: video.id, role: { in: ["HLS_MANIFEST", "HLS_SEGMENT"] } } });
        await tx.videoFile.createMany({ data: records });
        await tx.video.update({ where: { id: video.id }, data: { status: "READY", playbackKey: `${prefix}/index.m3u8`, posterKey: video.posterKey || posterKey, durationSeconds: Number(probe.format?.duration || 0) || null, width: videoStream?.width, height: videoStream?.height, mimeType: "application/vnd.apple.mpegurl", processingError: null } });
      });
      await job.updateProgress(100);
      return { manifestKey: `${prefix}/index.m3u8`, segmentCount: records.length - 1, posterSize };
    } catch (error) {
      await prisma.video.update({ where: { id: video.id }, data: { status: "FAILED", processingError: error instanceof Error ? error.message.slice(0, 500) : "HLS_TRANSCODE_FAILED" } }).catch(() => undefined);
      throw error;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }, { connection, concurrency: Math.max(1, Number(process.env.MEDIA_WORKER_CONCURRENCY || 1)) });
}

export async function closeMediaProcessingResources() { await prisma.$disconnect(); }
