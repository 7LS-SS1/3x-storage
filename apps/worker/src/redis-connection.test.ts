import { describe, expect, it } from "vitest";
import { redisConnectionSettings } from "./redis-connection.js";

describe("Redis connection settings", () => {
  it("preserves URL-sensitive characters in production passwords", () => {
    expect(redisConnectionSettings({
      NODE_ENV: "production",
      REDIS_URL: "redis://redis:6379/0",
      REDIS_PASSWORD: "strong@password:#/%",
      LOCAL_REDIS_URL: undefined
    })).toEqual({
      url: "redis://redis:6379/0",
      password: "strong@password:#/%"
    });
  });
});
