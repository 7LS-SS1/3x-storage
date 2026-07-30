import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware, resolveStorageOrigin } from "./middleware";

describe("storage content security policy", () => {
  it("resolves the exact virtual-hosted R2 bucket origin", () => {
    expect(resolveStorageOrigin({
      STORAGE_DRIVER: "r2",
      R2_ACCOUNT_ID: "account-id",
      R2_BUCKET: "3xapi",
      R2_S3_ENDPOINT: "https://account-id.r2.cloudflarestorage.com"
    })).toBe("https://3xapi.account-id.r2.cloudflarestorage.com");
  });

  it("rejects an invalid R2 bucket name instead of weakening CSP", () => {
    expect(resolveStorageOrigin({
      STORAGE_DRIVER: "r2",
      R2_BUCKET: "3xapi; https://attacker.invalid",
      R2_S3_ENDPOINT: "https://account-id.r2.cloudflarestorage.com"
    })).toBeNull();
  });

  it("uses the exact endpoint origin for path-style MinIO", () => {
    expect(resolveStorageOrigin({
      STORAGE_DRIVER: "s3",
      S3_BUCKET: "videos",
      S3_ENDPOINT: "http://localhost:9000",
      S3_FORCE_PATH_STYLE: "true"
    })).toBe("http://localhost:9000");
  });
});

describe("authentication middleware", () => {
  it("rejects a missing session on protected routes", () => {
    const response = middleware(new NextRequest("http://localhost:3000/dashboard"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login?next=%2Fdashboard");
  });

  it("rejects malformed attacker-controlled cookies", () => {
    const request = new NextRequest("http://localhost:3000/dashboard", {
      headers: { cookie: "video_session=attacker-value" }
    });
    expect(middleware(request).status).toBe(307);
  });

  it("uses a well-formed token only as an optimistic check", () => {
    const request = new NextRequest("http://localhost:3000/dashboard", {
      headers: { cookie: `video_session=${"a".repeat(43)}` }
    });
    const response = middleware(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toContain("nonce-");
  });

  it("does not require a session for the login route", () => {
    const response = middleware(new NextRequest("http://localhost:3000/login"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("allows an embed page to be framed only by its referring HTTPS origin", () => {
    const request = new NextRequest("https://player.example.test/embed/video-public-id", {
      headers: { referer: "https://sports.example.test/watch/123" }
    });
    const response = middleware(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors https://sports.example.test"
    );
    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
  });

  it("keeps direct embed navigation non-frameable when no parent referrer exists", () => {
    const response = middleware(
      new NextRequest("https://player.example.test/embed/video-public-id")
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'"
    );
  });

  it("allows only the Google Picker origins required by Drive import", () => {
    const request = new NextRequest("http://localhost:3000/upload", {
      headers: { cookie: `video_session=${"a".repeat(43)}` }
    });
    const policy = middleware(request).headers.get("content-security-policy");
    expect(policy).toContain(
      "frame-src 'self' https://docs.google.com https://drive.google.com https://accounts.google.com https://picker.googleapis.com"
    );
    expect(policy).toContain("https://www.googleapis.com");
    expect(policy).not.toContain("frame-src *");
  });
});
