import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MiniPoster } from "./video-poster";

describe("MiniPoster", () => {
  it("renders the current video cover inside mini-thumb", () => {
    const markup = renderToStaticMarkup(
      <MiniPoster title="วิดีโอทดสอบ" url="https://media.example.test/images/cover.webp" />
    );

    expect(markup).toContain('class="mini-thumb mini-thumb-image"');
    expect(markup).toContain('src="https://media.example.test/images/cover.webp"');
    expect(markup).toContain('alt="รูปหน้าปก วิดีโอทดสอบ"');
  });

  it("renders a clear empty state when no cover exists", () => {
    const markup = renderToStaticMarkup(<MiniPoster title="ไม่มีปก" url={null} />);

    expect(markup).toContain('class="mini-thumb mini-thumb-empty"');
    expect(markup).toContain("ไม่มีรูป");
    expect(markup).not.toContain("<img");
  });
});
