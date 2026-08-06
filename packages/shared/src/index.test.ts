import { describe, expect, it } from "vitest";
import { domainMatches, normalizeDomain, permissions, signMedia, signPoster, verifyMedia } from "./index";

describe("security primitives", () => {
  it("normalizes domains safely", () => expect(normalizeDomain(" Example.COM. ")).toBe("example.com"));
  it("normalizes international domains to ASCII", () => expect(normalizeDomain("ตัวอย่าง.ไทย")).toBe("xn--72c1a1bt4awk9o.xn--o3cw4h"));
  it.each(["bad_host.example", "-bad.example", "bad-.example", "example.com/path", "example.com@attacker.test"])("rejects malformed domain %s", value => {
    expect(() => normalizeDomain(value)).toThrow("INVALID_DOMAIN");
  });
  it("rejects attacker suffixes", () => expect(domainMatches("example.com.attacker.test", "example.com", true)).toBe(false));
  it("accepts real subdomains only when enabled", () => expect(domainMatches("media.example.com", "example.com", true)).toBe(true));
  it("enforces staff restrictions", () => expect(permissions.STAFF.has("users:manage")).toBe(false));
  it("signs and verifies media claims", () => {
    const secret = "s".repeat(32);
    const sig = signMedia({ path: "a.mp4", expires: 123, sessionId: "s", videoId: "v", fileId: "f" }, secret);
    expect(verifyMedia(sig, sig)).toBe(true);
    expect(verifyMedia("0".repeat(64), sig)).toBe(false);
  });
  it("rejects delimiter injection into signed claims", () => {
    expect(() => signMedia({ path: "a\nb", expires: 123, sessionId: "s", videoId: "v", fileId: "f" }, "s".repeat(32))).toThrow();
  });
  it("domain-separates permanent poster signatures from expiring media signatures", () => {
    const secret = "s".repeat(32);
    const poster = signPoster({ path: "images/v/poster.webp", videoId: "video-test", fileId: "file-test" }, secret);
    const media = signMedia({ path: "images/v/poster.webp", expires: 123, sessionId: "poster_v1", videoId: "video-test", fileId: "file-test" }, secret);
    expect(poster).toMatch(/^[a-f0-9]{64}$/);
    expect(poster).not.toBe(media);
  });
  it("rejects delimiter injection into permanent poster claims", () => {
    expect(() => signPoster({ path: "images/a\nb.webp", videoId: "video-test", fileId: "file-test" }, "s".repeat(32))).toThrow();
  });
});
