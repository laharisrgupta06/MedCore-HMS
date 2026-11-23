-- M-15 notification duplicate key. Moved into prisma/migrations on 2026-11-23 after validation on a disposable PostgreSQL 16 database; the review record stays in prisma/proposed/20261122130000_notification_dedupe/.
ALTER TABLE "notifications" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "notifications_recipientId_dedupeKey_key" ON "notifications"("recipientId", "dedupeKey");
CREATE INDEX "notification_deliveries_status_updatedAt_idx" ON "notification_deliveries"("status", "updatedAt");
