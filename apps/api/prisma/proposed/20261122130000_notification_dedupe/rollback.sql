-- M-15 ROLLBACK DRAFT. NOT APPLIED.
DROP INDEX IF EXISTS "notification_deliveries_status_updatedAt_idx";
DROP INDEX IF EXISTS "notifications_recipientId_dedupeKey_key";
ALTER TABLE "notifications" DROP COLUMN IF EXISTS "dedupeKey";
