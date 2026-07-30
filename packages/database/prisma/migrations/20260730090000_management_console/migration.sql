-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "siteName" TEXT NOT NULL DEFAULT 'สนามคลาวด์',
    "uploadsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultCategoryId" TEXT,
    "supportEmail" TEXT,
    "storageWarningPercent" INTEGER NOT NULL DEFAULT 85,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SystemConfig_singleton_check" CHECK ("id" = 1),
    CONSTRAINT "SystemConfig_storage_warning_check"
      CHECK ("storageWarningPercent" >= 50 AND "storageWarningPercent" <= 99)
);

-- CreateIndex
CREATE INDEX "SystemConfig_defaultCategoryId_idx"
ON "SystemConfig"("defaultCategoryId");

-- CreateIndex
CREATE INDEX "SystemConfig_updatedById_idx"
ON "SystemConfig"("updatedById");

-- AddForeignKey
ALTER TABLE "SystemConfig"
ADD CONSTRAINT "SystemConfig_defaultCategoryId_fkey"
FOREIGN KEY ("defaultCategoryId") REFERENCES "Category"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemConfig"
ADD CONSTRAINT "SystemConfig_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed singleton configuration.
INSERT INTO "SystemConfig" (
    "id",
    "siteName",
    "uploadsEnabled",
    "storageWarningPercent",
    "createdAt",
    "updatedAt"
)
VALUES (1, 'สนามคลาวด์', true, 85, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
