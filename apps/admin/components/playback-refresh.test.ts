import { describe, expect, it } from "vitest";
import { playbackRefreshDelay } from "./playback-refresh";

describe("playback authorization refresh", () => {
  it("refreshes one minute before the signed media URL expires", () => {
    expect(playbackRefreshDelay(1_700_000_600, 1_700_000_000_000)).toBe(540_000);
  });

  it("refreshes promptly when the expiry is already close", () => {
    expect(playbackRefreshDelay(1_700_000_010, 1_700_000_000_000)).toBe(1_000);
  });
});
