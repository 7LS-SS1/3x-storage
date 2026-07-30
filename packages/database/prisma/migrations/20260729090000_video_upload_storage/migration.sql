-- CreateEnum
CREATE TYPE "VideoFileRole" AS ENUM (
    'ORIGINAL',
    'PLAYBACK',
    'POSTER',
    'HLS_MANIFEST',
    'HLS_SEGMENT'
);

-- AlterEnum
ALTER TYPE "UploadStatus" ADD VALUE 'COMPLETING';
ALTER TYPE "UploadStatus" ADD VALUE 'FAILED';

-- AlterEnum
ALTER TYPE "VideoStatus" ADD VALUE 'UPLOADED';
ALTER TYPE "VideoStatus" ADD VALUE 'INSPECTING';
ALTER TYPE "VideoStatus" ADD VALUE 'UNPLAYABLE';
ALTER TYPE "VideoStatus" ADD VALUE 'DELETING';

-- AlterTable
ALTER TABLE "Category"
ADD COLUMN "description" TEXT;

-- AlterTable
ALTER TABLE "UploadSession"
ADD COLUMN "expectedParts" INTEGER NOT NULL,
ADD COLUMN "extension" TEXT NOT NULL,
ADD COLUMN "failureReason" TEXT,
ADD COLUMN "fileId" TEXT NOT NULL,
ADD COLUMN "mimeType" TEXT NOT NULL,
ADD COLUMN "originalFilename" TEXT NOT NULL,
ADD COLUMN "partSizeBytes" INTEGER NOT NULL,
ADD COLUMN "sizeBytes" BIGINT NOT NULL,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN "uploadedById" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Video"
ADD COLUMN "originalFilename" TEXT,
ADD COLUMN "processingError" TEXT,
ADD COLUMN "uploadedAt" TIMESTAMP(3),
ALTER COLUMN "playCount" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "VideoFile"
DROP COLUMN "kind",
DROP COLUMN "size",
ADD COLUMN "audioCodec" TEXT,
ADD COLUMN "bitrate" BIGINT,
ADD COLUMN "container" TEXT,
ADD COLUMN "extension" TEXT NOT NULL,
ADD COLUMN "filename" TEXT NOT NULL,
ADD COLUMN "height" INTEGER,
ADD COLUMN "role" "VideoFileRole" NOT NULL,
ADD COLUMN "sizeBytes" BIGINT NOT NULL,
ADD COLUMN "videoCodec" TEXT,
ADD COLUMN "width" INTEGER;

-- CreateTable
CREATE TABLE "UploadPart" (
    "id" TEXT NOT NULL,
    "uploadSessionId" TEXT NOT NULL,
    "partNumber" INTEGER NOT NULL,
    "etag" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadPart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadPart_uploadSessionId_partNumber_key"
ON "UploadPart"("uploadSessionId", "partNumber");

-- CreateIndex
CREATE UNIQUE INDEX "UploadSession_fileId_key"
ON "UploadSession"("fileId");

-- CreateIndex
CREATE INDEX "UploadSession_uploadedById_createdAt_idx"
ON "UploadSession"("uploadedById", "createdAt");

-- CreateIndex
CREATE INDEX "Video_deletedAt_createdAt_idx"
ON "Video"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "VideoFile_videoId_role_idx"
ON "VideoFile"("videoId", "role");

-- AddForeignKey
ALTER TABLE "UploadSession"
ADD CONSTRAINT "UploadSession_uploadedById_fkey"
FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadPart"
ADD CONSTRAINT "UploadPart_uploadSessionId_fkey"
FOREIGN KEY ("uploadSessionId") REFERENCES "UploadSession"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
