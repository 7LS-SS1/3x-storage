-- CreateEnum
CREATE TYPE "ExternalImportStatus" AS ENUM (
  'QUEUED',
  'VALIDATING',
  'TRANSFERRING',
  'COMPLETING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

-- CreateTable
CREATE TABLE "GoogleDriveConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "googleUserId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "refreshTokenEncrypted" TEXT NOT NULL,
  "grantedScopes" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GoogleDriveConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalOAuthState" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "codeVerifierEncrypted" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ExternalOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleDriveImport" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "connectionId" TEXT,
  "googleFileId" TEXT NOT NULL,
  "headRevisionId" TEXT,
  "sourceModifiedAt" TIMESTAMP(3),
  "md5Checksum" TEXT,
  "filename" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "categoryId" TEXT,
  "videoId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "storageUploadId" TEXT,
  "status" "ExternalImportStatus" NOT NULL DEFAULT 'QUEUED',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "transferredBytes" BIGINT NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GoogleDriveImport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoogleDriveImport_progress_check"
    CHECK ("progress" >= 0 AND "progress" <= 100),
  CONSTRAINT "GoogleDriveImport_size_check"
    CHECK ("sizeBytes" > 0 AND "transferredBytes" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleDriveConnection_userId_key"
ON "GoogleDriveConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalOAuthState_stateHash_key"
ON "ExternalOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "ExternalOAuthState_userId_provider_expiresAt_idx"
ON "ExternalOAuthState"("userId", "provider", "expiresAt");

-- CreateIndex
CREATE INDEX "ExternalOAuthState_expiresAt_usedAt_idx"
ON "ExternalOAuthState"("expiresAt", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleDriveImport_videoId_key"
ON "GoogleDriveImport"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleDriveImport_fileId_key"
ON "GoogleDriveImport"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleDriveImport_storageKey_key"
ON "GoogleDriveImport"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleDriveImport_storageUploadId_key"
ON "GoogleDriveImport"("storageUploadId");

-- CreateIndex
CREATE INDEX "GoogleDriveImport_userId_createdAt_idx"
ON "GoogleDriveImport"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "GoogleDriveImport_connectionId_googleFileId_sourceModifiedAt_idx"
ON "GoogleDriveImport"("connectionId", "googleFileId", "sourceModifiedAt");

-- CreateIndex
CREATE INDEX "GoogleDriveImport_status_updatedAt_idx"
ON "GoogleDriveImport"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "GoogleDriveConnection"
ADD CONSTRAINT "GoogleDriveConnection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalOAuthState"
ADD CONSTRAINT "ExternalOAuthState_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleDriveImport"
ADD CONSTRAINT "GoogleDriveImport_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleDriveImport"
ADD CONSTRAINT "GoogleDriveImport_connectionId_fkey"
FOREIGN KEY ("connectionId") REFERENCES "GoogleDriveConnection"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleDriveImport"
ADD CONSTRAINT "GoogleDriveImport_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleDriveImport"
ADD CONSTRAINT "GoogleDriveImport_videoId_fkey"
FOREIGN KEY ("videoId") REFERENCES "Video"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
