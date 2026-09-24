ALTER TABLE "Template"
  ADD COLUMN "attachmentName" TEXT,
  ADD COLUMN "attachmentMimeType" TEXT,
  ADD COLUMN "attachmentData" TEXT;

ALTER TABLE "Campaign"
  ADD COLUMN "attachmentName" TEXT,
  ADD COLUMN "attachmentMimeType" TEXT,
  ADD COLUMN "attachmentData" TEXT;

CREATE OR REPLACE FUNCTION copy_template_attachment_to_campaign()
RETURNS trigger AS $$
BEGIN
  IF NEW."templateId" IS NOT NULL THEN
    SELECT t."attachmentName", t."attachmentMimeType", t."attachmentData"
      INTO NEW."attachmentName", NEW."attachmentMimeType", NEW."attachmentData"
      FROM "Template" t
      WHERE t."id" = NEW."templateId";
  ELSE
    NEW."attachmentName" := NULL;
    NEW."attachmentMimeType" := NULL;
    NEW."attachmentData" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaign_template_attachment_snapshot
BEFORE INSERT OR UPDATE OF "templateId" ON "Campaign"
FOR EACH ROW
EXECUTE FUNCTION copy_template_attachment_to_campaign();
