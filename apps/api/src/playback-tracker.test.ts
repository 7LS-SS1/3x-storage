import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { playbackTracker } from "./playback-tracker";

describe("embed viewer rate limit", () => {
  afterEach(() => vi.unstubAllEnvs());
  const secret = "s".repeat(64);
  function request(viewer: string, age = 0) {
    const payload = `${Math.floor(Date.now() / 1000) - age}:${viewer.repeat(64)}`;
    const signature = createHmac("sha256", secret).update(payload).digest("hex");
    return { ip: "172.18.0.2", headers: { "x-embed-viewer": `${payload}:${signature}` } };
  }
  it("separates viewers behind the same admin server and keeps one viewer stable", () => {
    vi.stubEnv("SESSION_SECRET", secret);
    expect(playbackTracker(request("a"))).not.toBe(playbackTracker(request("b")));
    expect(playbackTracker(request("a"))).toBe(playbackTracker(request("a", 5)));
  });
  it("falls back to IP for forged, expired, or missing signatures", () => {
    vi.stubEnv("SESSION_SECRET", secret);
    expect(playbackTracker(request("a", 120))).toBe("172.18.0.2");
    const forged = request("a");
    forged.headers["x-embed-viewer"] += "0";
    expect(playbackTracker(forged)).toBe("172.18.0.2");
    expect(playbackTracker({ ip: "172.18.0.2", headers: {} })).toBe("172.18.0.2");
    vi.stubEnv("SESSION_SECRET", "different-secret".repeat(4));
    expect(playbackTracker(request("a"))).toBe("172.18.0.2");
  });
});
