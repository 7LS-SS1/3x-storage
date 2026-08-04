import IORedis from "ioredis";

type RedisEnvironment = Partial<Record<"NODE_ENV" | "REDIS_URL" | "REDIS_PASSWORD" | "LOCAL_REDIS_URL", string>>;

export function redisConnectionSettings(environment: RedisEnvironment = process.env) {
  const production = environment.NODE_ENV === "production";
  return {
    url: production
      ? environment.REDIS_URL || "redis://localhost:6379"
      : environment.LOCAL_REDIS_URL || "redis://localhost:6379",
    password: production && environment.REDIS_PASSWORD
      ? environment.REDIS_PASSWORD
      : undefined
  };
}

export function createRedisConnection() {
  const settings = redisConnectionSettings();
  return new IORedis(settings.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    ...(settings.password ? { password: settings.password } : {})
  });
}
