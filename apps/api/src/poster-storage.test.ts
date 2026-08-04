import { describe, expect, it } from "vitest";
import { uploadedPosterStorageKey } from "./poster-storage";

describe("uploadedPosterStorageKey", () => {
  it("stores uploaded covers below the R2 images prefix", () => {
    expect(uploadedPosterStorageKey("video-123", "poster-456", "webp"))
      .toBe("images/video-123/poster-456.webp");
  });
});
