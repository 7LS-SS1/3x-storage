import { createHmac, timingSafeEqual } from "node:crypto";
import { domainToASCII } from "node:url";

export type Role = "SYSTEM" | "ADMIN" | "STAFF";
export const permissions = {
  SYSTEM: new Set(["users:manage", "settings:manage", "videos:manage", "audit:read"]),
  ADMIN: new Set(["staff:manage", "videos:manage", "audit:read"]),
  STAFF: new Set(["videos:own"])
} satisfies Record<Role, ReadonlySet<string>>;

export function normalizeDomain(input: string): string {
  const value = input.trim().toLowerCase().replace(/\.$/, "");
  if (!value || value.length > 253 || value.includes("/") || value.includes(":") || value.includes("..") || /[\s@\\#?]/.test(value)) {
    throw new Error("INVALID_DOMAIN");
  }
  const ascii = domainToASCII(value);
  const labels = ascii.split(".");
  if (!ascii || labels.some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw new Error("INVALID_DOMAIN");
  }
  return ascii;
}

export function domainMatches(host: string, allowed: string, includeSubdomains: boolean): boolean {
  const normalizedHost = normalizeDomain(host);
  const normalizedAllowed = normalizeDomain(allowed);
  return normalizedHost === normalizedAllowed || (includeSubdomains && normalizedHost.endsWith(`.${normalizedAllowed}`));
}

export function signMedia(input: { path: string; expires: number; sessionId: string; videoId: string; fileId: string }, secret: string) {
  if (secret.length < 32 || Object.values(input).some(value => String(value).includes("\n"))) throw new Error("INVALID_SIGNING_INPUT");
  return createHmac("sha256", secret).update([input.path, input.expires, input.sessionId, input.videoId, input.fileId].join("\n")).digest("hex");
}

export function signPoster(input: { path: string; videoId: string; fileId: string }, secret: string) {
  if (secret.length < 32 || Object.values(input).some(value => value.includes("\n"))) throw new Error("INVALID_SIGNING_INPUT");
  return createHmac("sha256", secret)
    .update(["poster_v1", input.path, input.videoId, input.fileId].join("\n"))
    .digest("hex");
}

export function verifyMedia(signature: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(signature) || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}
