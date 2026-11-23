# M-15 proposal: durable notification duplicate key and sweeper index (NOT APPLIED, NOT VALIDATED)

> 2026-11-23: moved into `prisma/migrations/20261122130000_notification_dedupe/` with its schema.prisma change, after validation on a disposable database. Not yet applied to the owner's development database; that needs the owner's separate approval.

Status: required by approved DEC-062. Prepared 2026-11-22. Nothing here has been run against any database.

## Why

DEC-062 asks for a duplicate-prevention key on `notifications`. Phase 9 code works without it: `NotificationWriter` checks for an existing row (same recipient, type and entity) before inserting a "once" notification. But two concurrent writers, such as a retried event and the original, can both pass that check and insert twice. A unique key makes the database the final guard. The sweeper also scans `notification_deliveries` by status and age, which has no index today.

## Changes

1. `notifications."dedupeKey" TEXT NULL`, and a unique key on `("recipientId", "dedupeKey")`. PostgreSQL treats NULLs as distinct, so notifications that may repeat (reschedules, stock alerts) keep `dedupeKey` NULL. Prisma can model this as `@@unique`, so there is no drift.
2. An index on `notification_deliveries (status, "updatedAt")` for the sweeper.

## Code change after approval (small)

`NotificationWriter.stage` sets `dedupeKey` for one-time notifications: `"<type>:<entityId>"`, or `"<type>:<entityId>:<appointment time>"` for reminders, so a rescheduled visit gets new reminders. It treats a unique violation (P2002) on that key as "already notified". The in-code check stays as a fast path.

No outbox table is needed. Since the 2026-11-22 revision, notification and delivery rows are written inside each business transaction, so the existing tables already act as the outbox and the sweeper re-queues anything not queued after commit.

## Safety

Existing rows get `dedupeKey` NULL, so nothing conflicts and no backfill is needed. Both statements are additive. On a large table `CREATE INDEX` locks writes while it builds; the table is small today.
