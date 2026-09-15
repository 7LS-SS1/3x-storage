-- Public iframe embeds do not require domain registration by default.
ALTER TABLE "SystemConfig" ALTER COLUMN "allowAllDomains" SET DEFAULT true;

INSERT INTO "SystemConfig" ("id", "allowAllDomains", "createdAt", "updatedAt")
VALUES (1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE
SET "allowAllDomains" = true, "updatedAt" = CURRENT_TIMESTAMP;
