import { Controller, Get } from "@nestjs/common";
@Controller("health")
export class HealthController {
  @Get("live") live() { return { status: "ok" }; }
  @Get("ready") ready() {
    return {
      status: "configuration-check",
      services: {
        database: Boolean(process.env.DATABASE_URL),
        redis: Boolean(process.env.REDIS_URL),
        storage: Boolean(process.env.R2_BUCKET || process.env.S3_BUCKET),
        queue: Boolean(process.env.REDIS_URL)
      }
    };
  }
}
