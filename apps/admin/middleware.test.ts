import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

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
});
