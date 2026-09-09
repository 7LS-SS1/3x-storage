import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { isHlsPlayback, requestPlayerFullscreen, selectHlsPlaybackMode, SecureVideoPlayer, togglePlayerFullscreen } from "./index";

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

describe("player fullscreen", () => {
  it("uses the standard Fullscreen API when it is available", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);

    requestPlayerFullscreen(
      { requestFullscreen } as unknown as HTMLElement,
      {} as HTMLVideoElement,
      true
    );

    expect(requestFullscreen).toHaveBeenCalledOnce();
  });

  it("uses native iPhone video fullscreen when element fullscreen is unavailable", () => {
    const webkitEnterFullscreen = vi.fn();

    requestPlayerFullscreen(
      {} as HTMLElement,
      { webkitEnterFullscreen, webkitSupportsFullscreen: true } as unknown as HTMLVideoElement,
      false
    );

    expect(webkitEnterFullscreen).toHaveBeenCalledOnce();
  });

  it("falls back to native video fullscreen when a standard request is rejected", async () => {
    const webkitEnterFullscreen = vi.fn();

    requestPlayerFullscreen(
      { requestFullscreen: vi.fn().mockRejectedValue(new Error("not allowed")) } as unknown as HTMLElement,
      { webkitEnterFullscreen } as unknown as HTMLVideoElement,
      true
    );
    await Promise.resolve();

    expect(webkitEnterFullscreen).toHaveBeenCalledOnce();
  });

  it("exits standard fullscreen when the player is already fullscreen", () => {
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);

    togglePlayerFullscreen(
      {} as HTMLElement,
      {} as HTMLVideoElement,
      { fullscreenElement: {} as Element, fullscreenEnabled: true, exitFullscreen }
    );

    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it("exits the native iPhone fullscreen player", () => {
    const webkitExitFullscreen = vi.fn();

    togglePlayerFullscreen(
      {} as HTMLElement,
      { webkitDisplayingFullscreen: true, webkitExitFullscreen } as unknown as HTMLVideoElement,
      { fullscreenElement: null, fullscreenEnabled: false }
    );

    expect(webkitExitFullscreen).toHaveBeenCalledOnce();
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
