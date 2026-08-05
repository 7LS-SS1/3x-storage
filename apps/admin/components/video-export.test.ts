import { describe, expect, it } from "vitest";
import { createVideosCsv } from "./video-export";

describe("video CSV export", () => {
  it("uses the requested columns and embeds each video in an iframe", () => {
    const csv = createVideosCsv([{
      title: "วิดีโอ, \"ทดสอบ\"",
      category: "บทเรียน, พื้นฐาน",
      embedUrl: "https://player.example.test/embed/public-video"
    }]);

    expect(csv).toContain("\uFEFFtitle,หมวดหมู่,videos url\r\n");
    expect(csv).toContain('"วิดีโอ, ""ทดสอบ"""');
    expect(csv).toContain('"บทเรียน, พื้นฐาน"');
    expect(csv).toContain('"<iframe src=""https://player.example.test/embed/public-video""');
  });

  it("neutralizes spreadsheet formulas in video titles", () => {
    const csv = createVideosCsv([{
      title: "=HYPERLINK(\"https://malicious.example\")",
      category: "+SUM(1,1)",
      embedUrl: "https://player.example.test/embed/public-video"
    }]);

    expect(csv).toContain('"\'=HYPERLINK(');
    expect(csv).toContain('"\'+SUM(1,1)"');
  });
});
