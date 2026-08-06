import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signPoster } from "@video/shared";
import { createPosterDeliveryUrl } from "./poster-delivery-url";

describe("createPosterDeliveryUrl", () => {
  const previous = {
    mediaUrl: process.env.MEDIA_URL,
    mediaSecret: process.env.MEDIA_SIGNING_SECRET
  };

  beforeEach(() => {
    process.env.MEDIA_URL = "https://media.example.test";
    process.env.MEDIA_SIGNING_SECRET = "s".repeat(32);
  });

  afterEach(() => {
    if (previous.mediaUrl === undefined) delete process.env.MEDIA_URL;
    else process.env.MEDIA_URL = previous.mediaUrl;
    if (previous.mediaSecret === undefined) delete process.env.MEDIA_SIGNING_SECRET;
    else process.env.MEDIA_SIGNING_SECRET = previous.mediaSecret;
  });

  it("creates a directly usable signed Edge URL", () => {
    const result = createPosterDeliveryUrl({
      videoPublicId: "public-video-one",
      fileId: "file-video-one",
      storageKey: "images/video-one/poster.webp"
    });
    const url = new URL(result);

    expect(url.origin).toBe("https://media.example.test");
    expect(url.pathname).toBe("/images/video-one/poster.webp");
    expect(url.searchParams.get("purpose")).toBe("poster");
    expect(url.searchParams.has("expires")).toBe(false);
    expect(url.searchParams.has("sessionId")).toBe(false);
    expect(url.searchParams.get("videoId")).toBe("public-video-one");
    expect(url.searchParams.get("fileId")).toBe("file-video-one");
    expect(url.searchParams.get("signature")).toBe(signPoster({
      path: "images/video-one/poster.webp",
      videoId: "public-video-one",
      fileId: "file-video-one"
    }, "s".repeat(32)));
  });
});
