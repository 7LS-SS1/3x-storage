-- CreateTable
CREATE TABLE "MetadataImportBatch" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "headerJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetadataImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetadataImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "siteUrl" TEXT,
    "postId" TEXT,
    "rawJson" JSONB NOT NULL,
    "normalizedJson" JSONB NOT NULL,
    "errorsJson" JSONB NOT NULL,
    "warningsJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "previewJson" JSONB,
    "previewToken" TEXT,
    "previewActorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetadataImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoMetadataImage" (
    "videoId" TEXT NOT NULL,
    "imageUrl" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VideoMetadataImage_pkey" PRIMARY KEY ("videoId")
);

-- CreateTable
CREATE TABLE "WordPressMetadataSource" (
    "id" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "targetVideoId" TEXT NOT NULL,
    "rawJson" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "latestChangeId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WordPressMetadataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetadataChange" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "beforeJson" JSONB NOT NULL,
    "afterJson" JSONB NOT NULL,
    "fieldsJson" JSONB NOT NULL,
    "sourceBefore" JSONB NOT NULL,
    "sourceAfter" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertedAt" TIMESTAMP(3),
    "revertedById" TEXT,

    CONSTRAINT "MetadataChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetadataImportRow_batchId_status_idx" ON "MetadataImportRow"("batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MetadataImportRow_batchId_ordinal_key" ON "MetadataImportRow"("batchId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "WordPressMetadataSource_siteUrl_postId_key" ON "WordPressMetadataSource"("siteUrl", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "MetadataChange_rowId_key" ON "MetadataChange"("rowId");

-- CreateIndex
CREATE INDEX "MetadataChange_videoId_createdAt_idx" ON "MetadataChange"("videoId", "createdAt");

-- CreateIndex
CREATE INDEX "MetadataChange_createdAt_idx" ON "MetadataChange"("createdAt");

-- AddForeignKey
ALTER TABLE "MetadataImportRow" ADD CONSTRAINT "MetadataImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MetadataImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMetadataImage" ADD CONSTRAINT "VideoMetadataImage_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordPressMetadataSource" ADD CONSTRAINT "WordPressMetadataSource_targetVideoId_fkey" FOREIGN KEY ("targetVideoId") REFERENCES "Video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetadataChange" ADD CONSTRAINT "MetadataChange_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "MetadataImportRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetadataChange" ADD CONSTRAINT "MetadataChange_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "WordPressMetadataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetadataChange" ADD CONSTRAINT "MetadataChange_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
