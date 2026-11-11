-- Additive metadata discovery tables only; existing schema drift deliberately excluded.
-- CreateTable
CREATE TABLE "MetadataVideoJob" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "samples" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetadataVideoJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetadataVideoTask" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dataJson" JSONB NOT NULL DEFAULT '{}',
    "objectIdentity" TEXT,
    "framesDone" INTEGER NOT NULL DEFAULT 0,
    "cacheHits" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetadataVideoTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetadataVideoMatch" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "seconds" DOUBLE PRECISION NOT NULL,
    "panel" TEXT NOT NULL,
    "thumbnail" TEXT NOT NULL,

    CONSTRAINT "MetadataVideoMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetadataVideoIndex" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "duration" DOUBLE PRECISION,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetadataVideoIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetadataVideoFrame" (
    "id" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "timeMs" INTEGER NOT NULL,
    "imageJson" JSONB NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetadataVideoFrame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetadataVideoJob_batchId_actorUserId_key" ON "MetadataVideoJob"("batchId", "actorUserId");

-- CreateIndex
CREATE INDEX "MetadataVideoTask_status_runAfter_leaseUntil_idx" ON "MetadataVideoTask"("status", "runAfter", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "MetadataVideoTask_jobId_kind_refId_key" ON "MetadataVideoTask"("jobId", "kind", "refId");

-- CreateIndex
CREATE INDEX "MetadataVideoMatch_jobId_rowId_score_idx" ON "MetadataVideoMatch"("jobId", "rowId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "MetadataVideoMatch_jobId_rowId_videoId_key" ON "MetadataVideoMatch"("jobId", "rowId", "videoId");

-- CreateIndex
CREATE INDEX "MetadataVideoIndex_videoId_idx" ON "MetadataVideoIndex"("videoId");

-- CreateIndex
CREATE INDEX "MetadataVideoFrame_lastUsedAt_idx" ON "MetadataVideoFrame"("lastUsedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MetadataVideoFrame_identity_timeMs_key" ON "MetadataVideoFrame"("identity", "timeMs");

-- AddForeignKey
ALTER TABLE "MetadataVideoJob" ADD CONSTRAINT "MetadataVideoJob_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MetadataImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetadataVideoTask" ADD CONSTRAINT "MetadataVideoTask_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MetadataVideoJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetadataVideoMatch" ADD CONSTRAINT "MetadataVideoMatch_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MetadataVideoJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetadataVideoFrame" ADD CONSTRAINT "MetadataVideoFrame_identity_fkey" FOREIGN KEY ("identity") REFERENCES "MetadataVideoIndex"("id") ON DELETE CASCADE ON UPDATE CASCADE;
