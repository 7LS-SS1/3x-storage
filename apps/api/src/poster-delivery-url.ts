import { ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { signMedia } from "@video/shared";

function posterUrlTtlSeconds() {
  return Math.min(
    Math.max(Number(process.env.MEDIA_URL_TTL_SECONDS || 600), 300),
    900
  );
}

export function createPosterDeliveryUrl(input: {
  videoPublicId: string;
  fileId: string;
  storageKey: string;
}) {
  const secret = process.env.MEDIA_SIGNING_SECRET;
  const configuredUrl = process.env.MEDIA_URL;
  if (
    !secret ||
    secret.length < 32 ||
    secret.startsWith("replace-with") ||
    !configuredUrl
  ) {
    throw new ServiceUnavailableException("ระบบส่งมอบรูปหน้าปกยังไม่พร้อมใช้งาน");
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(configuredUrl);
  } catch {
    throw new ServiceUnavailableException("ระบบส่งมอบรูปหน้าปกยังไม่พร้อมใช้งาน");
  }
  if (process.env.NODE_ENV === "production" && baseUrl.protocol !== "https:") {
    throw new ServiceUnavailableException("ระบบส่งมอบรูปหน้าปกยังไม่พร้อมใช้งาน");
  }

  const expires = Math.floor(Date.now() / 1000) + posterUrlTtlSeconds();
  const sessionId = randomUUID();
  const claims = {
    path: input.storageKey,
    expires,
    sessionId,
    videoId: input.videoPublicId,
    fileId: input.fileId
  };
  const mediaUrl = new URL(
    input.storageKey.split("/").map(encodeURIComponent).join("/"),
    `${baseUrl.toString().replace(/\/?$/, "/")}`
  );
  const signature = signMedia(claims, secret);
  Object.entries({
    expires: String(expires),
    sessionId,
    videoId: input.videoPublicId,
    fileId: input.fileId,
    signature
  }).forEach(([key, value]) => mediaUrl.searchParams.set(key, value));
  return mediaUrl.toString();
}
