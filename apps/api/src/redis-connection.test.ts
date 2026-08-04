import { describe, expect, it } from "vitest";
import { redisConnectionSettings } from "./redis-connection";

describe("Redis connection settings", () => {
  it("keeps production passwords separate from the Redis URL", () => {
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

  it("does not apply the production password to local development", () => {
    expect(redisConnectionSettings({
      NODE_ENV: "development",
      REDIS_URL: "redis://remote:6379/0",
      REDIS_PASSWORD: "production-only",
      LOCAL_REDIS_URL: "redis://localhost:6379/0"
    })).toEqual({
      url: "redis://localhost:6379/0",
      password: undefined
    });
  });
});
