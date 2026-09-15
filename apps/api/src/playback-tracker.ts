import { createHmac, timingSafeEqual } from "node:crypto";

export function playbackTracker(request: { ip?: string; headers?: Record<string, unknown> }) {
  const value = request.headers?.["x-embed-viewer"];
  const secret = process.env.SESSION_SECRET;
  if (typeof value === "string" && secret && secret.length >= 32) {
    const parts = /^(\d{10}):([a-f0-9]{64}):([a-f0-9]{64})$/.exec(value);
    if (parts && Math.abs(Date.now() / 1000 - Number(parts[1])) <= 60) {
      const expected = createHmac("sha256", secret).update(`${parts[1]}:${parts[2]}`).digest();
      if (timingSafeEqual(expected, Buffer.from(parts[3]!, "hex"))) return `viewer:${parts[2]}`;
    }
  }
  return request.ip || "unknown";
}
