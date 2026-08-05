-- Allow administrators to temporarily bypass the per-video domain allowlist.
ALTER TABLE "SystemConfig"
ADD COLUMN "allowAllDomains" BOOLEAN NOT NULL DEFAULT false;

-- Sessions created for arbitrary domains do not have an AllowedDomain record.
ALTER TABLE "PlaybackSession"
ALTER COLUMN "allowedDomainId" DROP NOT NULL;
