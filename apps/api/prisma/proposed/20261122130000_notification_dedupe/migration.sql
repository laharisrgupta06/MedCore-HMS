-- M-15 DRAFT. NOT APPLIED. NOT VALIDATED.
ALTER TABLE "notifications" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "notifications_recipientId_dedupeKey_key" ON "notifications"("recipientId", "dedupeKey");
CREATE INDEX "notification_deliveries_status_updatedAt_idx" ON "notification_deliveries"("status", "updatedAt");
