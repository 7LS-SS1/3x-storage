import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SecureVideoPlayer } from "./index";

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
