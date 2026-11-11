import { describe, expect, it } from "vitest";
import { canonicalSite, metadataHash, parseMetadataCsv, parseMetadataFile } from "./metadata-import.parser";

const parse = (rows: unknown) => parseMetadataFile(Buffer.from(JSON.stringify(rows)), "fixture.json");
describe("WordPress metadata parser", () => {
  it("preserves all exporter fields and never treats parsed embed ID as target", () => {
    const original = { site_url: "https://EXAMPLE.test/site/", post_id: 12, title: "ไทย", content_raw: '<p>เนื้อหา</p>[shortcode]<iframe src="https://storage.test/embed/a"></iframe>', excerpt_raw: "คำอธิบาย", taxonomies: { category: [{ term_id: 1, name: "หนึ่ง" }, { term_id: 2, name: "สอง" }], post_tag: ["tag"], actors: [{ name: "ผู้บรรยาย" }] }, iframe_sources: [{ parsed_embed_id: "a" }] };
    const row = parse({ schema_version: "1", records: [original] }).rows[0]!;
    expect(row.raw).toEqual(original); expect(row.normalized.targetVideoId).toBeUndefined(); expect(row.normalized.siteUrl).toBe("https://example.test/site"); expect(row.normalized.categories).toHaveLength(2); expect(row.normalized.description).toBe("คำอธิบาย"); expect(row.errors).toEqual([]);
  });
  it("rejects all duplicate source occurrences without selecting a winner", () => {
    const rows = parse([{ site_url: "https://example.test/", post_id: 1 }, { site_url: "https://EXAMPLE.test", post_id: "1" }]).rows;
    expect(rows.every(r => r.errors.some(e => e.includes("ซ้ำ")))).toBe(true);
  });
  it("roundtrips CSV quoted Thai, newline, comma and JSON arrays", () => {
    const csv = '\uFEFFsite_url,post_id,title,description,categories,tags\r\nhttps://example.test,1,"ไทย, ""quoted""","line1\r\nline2","[""A"",""B""]","[]"\r\n';
    const row = parseMetadataFile(Buffer.from(csv), "fixture.csv").rows[0]!;
    expect(row.normalized.title).toBe('ไทย, "quoted"'); expect(row.normalized.description).toBe("line1\r\nline2"); expect(row.normalized.categories).toEqual(["A", "B"]); expect(row.errors).toEqual([]);
  });
  it.each(['a,a\n1,2', 'a,b\n"x', 'a\n"x"junk', 'a,b\n1'])('rejects malformed CSV %s', text => expect(() => parseMetadataCsv(text)).toThrow());
  it("validates URLs IDs arrays and title length", () => {
    const row = parse([{ site_url: "https://user:pass@example.test", post_id: -1, categories: "not JSON", title: "x".repeat(201), image_url: "javascript:alert(1)" }]).rows[0]!;
    expect(row.errors).toHaveLength(5);
    expect(() => canonicalSite("https://example.test/?token=x")).toThrow();
  });
  it("rejects invalid UTF8, empty file, oversize and excess rows", () => {
    expect(() => parseMetadataFile(Buffer.from([0xff]), "f.json")).toThrow(); expect(() => parse([])).toThrow();
    expect(() => parseMetadataFile(Buffer.alloc(10 * 1024 * 1024 + 1), "f.json")).toThrow(); expect(() => parse(Array(501).fill({}))).toThrow();
  });
  it("keeps explicit empty descriptions and stable object fingerprints", () => {
    const row = parse([{ site_url: "https://example.test", post_id: 1, description: "", excerpt_raw: "fallback" }]).rows[0]!;
    expect(row.normalized.description).toBe(""); expect(metadataHash({ b: 1, a: [2] })).toBe(metadataHash({ a: [2], b: 1 }));
  });
});
