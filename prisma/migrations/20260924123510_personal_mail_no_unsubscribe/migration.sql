-- AlterTable
ALTER TABLE "Settings" ALTER COLUMN "includeUnsubscribe" SET DEFAULT false;

-- Personal 1:1 outreach: no unsubscribe footer / List-Unsubscribe headers by default.
UPDATE "Settings" SET "includeUnsubscribe" = false;
