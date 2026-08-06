import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifySignature } from "./index";
import {
  isPermanentPosterContentType,
  isPermanentPosterPath,
  permanentPosterSignedValue
} from "./poster-authorization";

describe("permanent poster authorization", () => {
  it("uses a domain-separated deterministic signing payload", () => {
    expect(permanentPosterSignedValue({
      path: "images/video/poster.webp",
      videoId: "video-test",
      fileId: "file-test"
    })).toBe("poster_v1\nimages/video/poster.webp\nvideo-test\nfile-test");
  });

  it("accepts the API-compatible HMAC and rejects a modified signature", async () => {
    const secret = "s".repeat(32);
    const value = permanentPosterSignedValue({
      path: "images/video/poster.webp",
      videoId: "video-test",
      fileId: "file-test"
    });
    const signature = createHmac("sha256", secret).update(value).digest("hex");
    const modified = `${signature.startsWith("0") ? "1" : "0"}${signature.slice(1)}`;
    await expect(verifySignature(secret, value, signature)).resolves.toBe(true);
    await expect(verifySignature(secret, value, modified)).resolves.toBe(false);
  });

  it.each([
    "images/video/poster.webp",
    "images/video/poster.jpg",
    "images/video/poster.jpeg",
    "images/video/poster.png"
  ])("allows supported image keys: %s", path => {
    expect(isPermanentPosterPath(path)).toBe(true);
  });

  it.each([
    "videos/video/playback.mp4",
    "images/video/manifest.m3u8",
    "images/video/poster.svg"
  ])("rejects non-poster keys: %s", path => {
    expect(isPermanentPosterPath(path)).toBe(false);
  });

  it.each(["image/jpeg", "image/png", "image/webp"])(
    "allows supported poster content types: %s",
    contentType => expect(isPermanentPosterContentType(contentType)).toBe(true)
  );

  it.each(["image/svg+xml", "text/html", "video/mp4"])(
    "rejects unsafe poster content types: %s",
    contentType => expect(isPermanentPosterContentType(contentType)).toBe(false)
  );
});
