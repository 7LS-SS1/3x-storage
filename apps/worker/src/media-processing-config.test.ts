import { describe, expect, it } from "vitest";
import { mediaMaxWidth, mediaPosterStorageKey, mediaPosterTime, mediaScaleFilter } from "./media-processing-config.js";

describe("media processing configuration", () => {
  it("uses a production-safe default without upscaling", () => {
    expect(mediaMaxWidth(undefined)).toBe(1920);
    expect(mediaScaleFilter(undefined)).toBe("scale='min(1920,iw)':-2");
  });

  it("accepts configured widths within the supported bounds", () => {
    expect(mediaMaxWidth("1280")).toBe(1280);
    expect(mediaScaleFilter("1280")).toBe("scale='min(1280,iw)':-2");
  });

  it("clamps unsafe values", () => {
    expect(mediaMaxWidth("1")).toBe(320);
    expect(mediaMaxWidth("99999")).toBe(7680);
    expect(mediaMaxWidth("not-a-number")).toBe(1920);
  });

  it("keeps poster capture inside short videos", () => {
    expect(mediaPosterTime(2, undefined)).toBe("1.000");
    expect(mediaPosterTime(120, undefined)).toBe("3.000");
    expect(mediaPosterTime(10, "4")).toBe("4.000");
    expect(mediaPosterTime(0, undefined)).toBe("0.000");
  });

  it("stores generated covers below the R2 images prefix", () => {
    expect(mediaPosterStorageKey("video-123")).toBe("images/video-123/poster.jpg");
  });
});
