-- Every active registered domain is allowed to play every non-deleted video.
-- Database triggers keep this invariant intact for all upload/import paths and
-- avoid races between domain registration and video creation.

CREATE OR REPLACE FUNCTION "assign_active_domains_to_new_video"()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "VideoAllowedDomain" ("videoId", "allowedDomainId", "createdAt")
  SELECT NEW."id", domain."id", CURRENT_TIMESTAMP
  FROM "AllowedDomain" AS domain
  WHERE domain."active" = TRUE
  ON CONFLICT ("videoId", "allowedDomainId") DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "auto_assign_domains_after_video_insert" ON "Video";
CREATE TRIGGER "auto_assign_domains_after_video_insert"
AFTER INSERT ON "Video"
FOR EACH ROW
EXECUTE FUNCTION "assign_active_domains_to_new_video"();

CREATE OR REPLACE FUNCTION "assign_active_domain_to_all_videos"()
RETURNS TRIGGER AS $$
DECLARE
  should_assign BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    should_assign := NEW."active" = TRUE;
  ELSIF TG_OP = 'UPDATE' THEN
    should_assign :=
      NEW."active" = TRUE
      AND OLD."active" IS DISTINCT FROM TRUE;
  END IF;

  IF should_assign THEN
    INSERT INTO "VideoAllowedDomain" ("videoId", "allowedDomainId", "createdAt")
    SELECT video."id", NEW."id", CURRENT_TIMESTAMP
    FROM "Video" AS video
    WHERE video."deletedAt" IS NULL
    ON CONFLICT ("videoId", "allowedDomainId") DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "auto_assign_videos_after_domain_change" ON "AllowedDomain";
CREATE TRIGGER "auto_assign_videos_after_domain_change"
AFTER INSERT OR UPDATE OF "active" ON "AllowedDomain"
FOR EACH ROW
EXECUTE FUNCTION "assign_active_domain_to_all_videos"();

INSERT INTO "VideoAllowedDomain" ("videoId", "allowedDomainId", "createdAt")
SELECT video."id", domain."id", CURRENT_TIMESTAMP
FROM "Video" AS video
CROSS JOIN "AllowedDomain" AS domain
WHERE video."deletedAt" IS NULL
  AND domain."active" = TRUE
ON CONFLICT ("videoId", "allowedDomainId") DO NOTHING;
