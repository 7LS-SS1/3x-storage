import { describe, expect, it } from "vitest";
import { createVideosCsv } from "./video-export";

describe("video CSV export", () => {
  it("uses the requested columns and embeds each video in an iframe", () => {
    const csv = createVideosCsv([{
      title: "วิดีโอ, \"ทดสอบ\"",
      embedUrl: "https://player.example.test/embed/public-video"
    }]);

    expect(csv).toContain("\uFEFFtitle,videos url\r\n");
    expect(csv).toContain('"วิดีโอ, ""ทดสอบ"""');
    expect(csv).toContain('"<iframe src=""https://player.example.test/embed/public-video""');
  });

  it("neutralizes spreadsheet formulas in video titles", () => {
    const csv = createVideosCsv([{
      title: "=HYPERLINK(\"https://malicious.example\")",
      embedUrl: "https://player.example.test/embed/public-video"
    }]);

    expect(csv).toContain('"\'=HYPERLINK(');
  });
});
