import { ServiceUnavailableException } from "@nestjs/common";
import { signPoster } from "@video/shared";

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

  const claims = {
    path: input.storageKey,
    videoId: input.videoPublicId,
    fileId: input.fileId
  };
  const mediaUrl = new URL(
    input.storageKey.split("/").map(encodeURIComponent).join("/"),
    `${baseUrl.toString().replace(/\/?$/, "/")}`
  );
  const signature = signPoster(claims, secret);
  Object.entries({
    purpose: "poster",
    videoId: input.videoPublicId,
    fileId: input.fileId,
    signature
  }).forEach(([key, value]) => mediaUrl.searchParams.set(key, value));
  return mediaUrl.toString();
}
