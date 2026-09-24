ALTER TABLE "mail"."Template"
  ADD COLUMN "attachmentName" TEXT,
  ADD COLUMN "attachmentMimeType" TEXT,
  ADD COLUMN "attachmentData" TEXT;

ALTER TABLE "mail"."Campaign"
  ADD COLUMN "attachmentName" TEXT,
  ADD COLUMN "attachmentMimeType" TEXT,
  ADD COLUMN "attachmentData" TEXT;
