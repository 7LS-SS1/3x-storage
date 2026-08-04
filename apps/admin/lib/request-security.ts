import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { securityConfig } from "./security-config";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function keyedHash(value: string, key: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

export function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function getRequestFingerprint(request: Pick<NextRequest, "headers">) {
  const userAgent = request.headers.get("user-agent")?.slice(0, 512) || "";
  const forwarded = process.env.TRUST_PROXY === "true"
    ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    : undefined;
  return {
    userAgentHash: userAgent ? keyedHash(userAgent, securityConfig.sessionSecret) : null,
    ipHash: forwarded ? keyedHash(forwarded, securityConfig.ipHashSalt) : null
  };
}

export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const expected = process.env.NODE_ENV === "production"
    ? new URL(process.env.ADMIN_URL || request.nextUrl.origin).origin
    : request.nextUrl.origin;
  if (!origin || origin !== expected || (fetchSite && fetchSite !== "same-origin")) {
    throw new Error("INVALID_ORIGIN");
  }
}

export const privateHeaders = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff"
};
