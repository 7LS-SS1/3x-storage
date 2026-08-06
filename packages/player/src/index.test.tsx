import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isHlsPlayback, selectHlsPlaybackMode, SecureVideoPlayer } from "./index";

describe("HLS source detection", () => {
  it("accepts standard and alternative HLS MIME types", () => {
    expect(isHlsPlayback("https://media.example/video", "application/vnd.apple.mpegurl")).toBe(true);
    expect(isHlsPlayback("https://media.example/video", "application/x-mpegURL")).toBe(true);
  });

  it("recognizes a signed manifest URL even when storage reports a generic MIME type", () => {
    expect(isHlsPlayback(
      "https://media.example/videos/video-123/hls/index.m3u8?signature=redacted",
      "application/octet-stream"
    )).toBe(true);
  });
});

describe("HLS playback mode", () => {
  it("prefers HLS.js when Chromium reports uncertain native HLS support", () => {
    expect(selectHlsPlaybackMode(true, "maybe")).toBe("hls.js");
  });

  it("uses native HLS only when HLS.js is unavailable", () => {
    expect(selectHlsPlaybackMode(false, "probably")).toBe("native");
  });

  it("reports unsupported only when neither playback mode is available", () => {
    expect(selectHlsPlaybackMode(false, "")).toBe("unsupported");
  });
});

describe("SecureVideoPlayer poster", () => {
  it("renders the cover as a play overlay before playback starts", () => {
    const markup = renderToStaticMarkup(
      <SecureVideoPlayer
        source="https://media.example/video.m3u8"
        sourceType="application/vnd.apple.mpegurl"
        poster="https://media.example/images/video-123/poster.jpg"
        title="วิดีโอทดสอบ"
      />
    );

    expect(markup).toContain('class="svp-poster"');
    expect(markup).toContain('src="https://media.example/images/video-123/poster.jpg"');
    expect(markup).toContain('aria-label="เล่นวิดีโอ วิดีโอทดสอบ"');
  });
});
