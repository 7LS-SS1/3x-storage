import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { HealthController } from "./health.controller";
import { PlaybackController } from "./playback.controller";
import { PrismaService } from "./prisma.service";
import { AdminSessionGuard, CsrfGuard } from "./admin-auth.guard";
import { CategoriesController } from "./categories.controller";
import { StorageController } from "./storage.controller";
import { StorageService } from "./storage.service";
import { UploadsController } from "./uploads.controller";
import { VideosController } from "./videos.controller";
import { AuditController } from "./audit.controller";
import { DomainsController } from "./domains.controller";
import { SystemSettingsController } from "./system-settings.controller";
import { UsersController } from "./users.controller";
import { DriveImportQueueService } from "./drive-import-queue.service";
import { GoogleDriveController } from "./google-drive.controller";
import { GoogleDriveService } from "./google-drive.service";
import { MediaProcessingQueueService } from "./media-processing-queue.service";
import { MetadataAdminGuard, MetadataImportController } from "./metadata-import.controller";
import { MetadataImportService } from "./metadata-import.service";
import { MetadataCoverController, MetadataCoverService } from "./metadata-cover.service";
import { MetadataCoverImages } from "./metadata-cover-image";
import { MetadataVideoController, MetadataVideoService } from "./metadata-video.service";
import { MetadataVideoFrames } from "./metadata-video-frames";

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  controllers: [
    HealthController,
    PlaybackController,
    VideosController,
    UploadsController,
    CategoriesController,
    StorageController,
    UsersController,
    DomainsController,
    AuditController,
    SystemSettingsController,
    GoogleDriveController,
    MetadataImportController,
    MetadataCoverController,
    MetadataVideoController
  ],
  providers: [
    PrismaService,
    StorageService,
    DriveImportQueueService,
    MediaProcessingQueueService,
    GoogleDriveService,
    AdminSessionGuard,
    CsrfGuard,
    MetadataAdminGuard,
    MetadataImportService,
    MetadataCoverService,
    MetadataCoverImages,
    MetadataVideoService,
    MetadataVideoFrames,
    { provide: APP_GUARD, useClass: ThrottlerGuard }
  ]
})
export class AppModule {}
