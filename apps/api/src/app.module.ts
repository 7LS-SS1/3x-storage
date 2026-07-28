import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { HealthController } from "./health.controller";
import { PlaybackController } from "./playback.controller";
import { PrismaService } from "./prisma.service";

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  controllers: [HealthController, PlaybackController],
  providers: [PrismaService, { provide: APP_GUARD, useClass: ThrottlerGuard }]
})
export class AppModule {}
