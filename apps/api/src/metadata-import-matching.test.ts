import { describe, expect, it } from "vitest";
import { metadataReferences } from "./metadata-import-matching";

describe("metadata source references", () => {
  const get = (record: unknown) => metadataReferences(record, "https://wp.example.test", ["https://storage.example.test"]);
  it("checks actual iframe URL and configured origin rather than exported parsed ID", () => {
    const r = get({ iframe_sources: [{ src_raw: "https://storage.example.test/embed/%E0%B9%84%E0%B8%97%E0%B8%A2?x=1&amp;y=2", parsed_embed_id: "wrong" }] });
    expect(r.references).toEqual([{ kind: "publicId", value: "ไทย", source: "iframe_sources", origin: "https://storage.example.test", trustedOrigin: true }]);
    expect(get({ parsed_embed_id: "unverified", title: "video" }).references).toEqual([]);
  });
  it("keeps foreign and relative origins unverified and deduplicates CSV references", () => {
    const r = get({ iframe_src: "//foreign.example.test/embed/id\n//foreign.example.test/embed/id\n/embed/relative" });
    expect(r.references).toHaveLength(2);
    expect(r.references.every(x => x.trustedOrigin === false)).toBe(true);
    expect(r.references[1]?.origin).toBe("https://wp.example.test");
  });
  it("never uses image filename, title or thumbnail URL to find video files", () => {
    expect(get({ filename: "cover.mp4", original_filename: "cover.mp4", title: "film.mp4", featured_image_url: "https://example.test/film.mp4" }).references).toEqual([]);
  });
  it("extracts exact decoded video filename without retaining signed URL secrets", () => {
    const r = get({ video_urls: [{ source_field: "video_url_720", value: ["https://media.example.test/path/%E0%B9%84%E0%B8%97%E0%B8%A2.mp4?secret=hidden"] }] });
    expect(r.references[0]?.value).toBe("ไทย.mp4");
    expect(JSON.stringify(r)).not.toContain("hidden");
  });
  it("ignores credentials, unsafe protocols, malformed encodings and misleading URL paths", () => {
    expect(get({ iframe_sources: ["javascript:alert(1)", "https://u:pass@storage.example.test/embed/id", "https://storage.example.test/embed/%GG", "https://storage.example.test/x/embed/id"].map(src_raw => ({ src_raw })) }).references).toEqual([]);
  });
  it("bounds reference count and reports truncation", () => {
    const r = get({ iframe_sources: Array.from({ length: 70 }, (_, i) => ({ src_raw: `https://storage.example.test/embed/${i}` })) });
    expect(r.references).toHaveLength(64); expect(r.warnings.length).toBeGreaterThan(0);
  });
});
