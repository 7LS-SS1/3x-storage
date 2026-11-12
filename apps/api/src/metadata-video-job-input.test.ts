import "reflect-metadata";
import { expect, it } from "vitest";
import { videoJobInput } from "./metadata-video-jobs.service";

it("accepts every frame score by default for new jobs", () => {
  expect(videoJobInput.parse({ samples: 30 }).threshold).toBe(0);
});

it("preserves explicit thresholds and rejects invalid scores", () => {
  for (const threshold of [0, 40, 80, 100]) {
    expect(videoJobInput.parse({ threshold }).threshold).toBe(threshold);
  }
  for (const threshold of [-1, 101, 0.5]) {
    expect(videoJobInput.safeParse({ threshold }).success).toBe(false);
  }
});
