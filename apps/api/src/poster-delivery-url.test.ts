import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signMedia } from "@video/shared";
import { createPosterDeliveryUrl } from "./poster-delivery-url";

describe("createPosterDeliveryUrl", () => {
  const previous = {
    mediaUrl: process.env.MEDIA_URL,
    mediaSecret: process.env.MEDIA_SIGNING_SECRET,
    mediaTtl: process.env.MEDIA_URL_TTL_SECONDS
  };

  beforeEach(() => {
    process.env.MEDIA_URL = "https://media.example.test";
    process.env.MEDIA_SIGNING_SECRET = "s".repeat(32);
    process.env.MEDIA_URL_TTL_SECONDS = "600";
  });

  afterEach(() => {
    if (previous.mediaUrl === undefined) delete process.env.MEDIA_URL;
    else process.env.MEDIA_URL = previous.mediaUrl;
    if (previous.mediaSecret === undefined) delete process.env.MEDIA_SIGNING_SECRET;
    else process.env.MEDIA_SIGNING_SECRET = previous.mediaSecret;
    if (previous.mediaTtl === undefined) delete process.env.MEDIA_URL_TTL_SECONDS;
    else process.env.MEDIA_URL_TTL_SECONDS = previous.mediaTtl;
  });

  it("creates a directly usable signed Edge URL", () => {
    const before = Math.floor(Date.now() / 1000);
    const result = createPosterDeliveryUrl({
      videoPublicId: "public-video-one",
      fileId: "file-video-one",
      storageKey: "images/video-one/poster.webp"
    });
    const url = new URL(result);
    const expires = Number(url.searchParams.get("expires"));
    const sessionId = url.searchParams.get("sessionId") || "";

    expect(url.origin).toBe("https://media.example.test");
    expect(url.pathname).toBe("/images/video-one/poster.webp");
    expect(expires).toBeGreaterThanOrEqual(before + 599);
    expect(expires).toBeLessThanOrEqual(before + 600);
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(url.searchParams.get("videoId")).toBe("public-video-one");
    expect(url.searchParams.get("fileId")).toBe("file-video-one");
    expect(url.searchParams.get("signature")).toBe(signMedia({
      path: "images/video-one/poster.webp",
      expires,
      sessionId,
      videoId: "public-video-one",
      fileId: "file-video-one"
    }, "s".repeat(32)));
  });
});
