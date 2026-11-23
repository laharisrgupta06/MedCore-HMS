# M-12 proposal: payment integrity (NOT APPLIED, NOT VALIDATED)

> 2026-11-23: moved into `prisma/migrations/20261122100000_payment_integrity/` with its schema.prisma change, after validation on a disposable database. Not yet applied to the owner's development database; that needs the owner's separate approval.

Status: design option A APPROVED (2026-11-22). Migration NOT APPLIED and not validated against a database. Nothing in this folder has been run against any database. Prisma does not read `prisma/proposed/`, so this cannot be applied by accident.

## Why M-12 is needed

Phase 8 (8-B5 cash and reversals, 8-B6 provider layer) changes money. The M-11b migration (`20261119220000_invoice_integrity`) deliberately refuses every status change on an issued invoice, and says that payment statuses will be set by "the payment rules (M-12)". Without M-12:

1. A cash or webhook payment cannot move an invoice to `PARTIALLY_PAID` or `PAID`. The database refuses it.
2. A reversal cannot be recorded. The `PaymentStatus` enum has no `REVERSED` value, and `payments` has no reversal columns.
3. Nothing stops a bug in application code from writing a payment that exceeds the balance, or from changing an amount after it succeeded.

Until M-12 is installed, the API returns `503 PAYMENT_RULES_PENDING` for every payment-changing action. It detects installation by looking for a trigger named `payments_invoice_status`, so M-12 must create a trigger with exactly that name.

## What is blocked until approval

- Recording cash (`POST /api/invoices/:id/payments/cash`) and starting a checkout are refused with `PAYMENT_RULES_PENDING`. Nothing is written.
- Success webhooks are refused in the same way. They roll back, so the provider's retry finds nothing half-done.
- Reversal (8-B5) cannot be implemented at all until the enum value and columns exist.
- Cancelling an open checkout still works, because it changes only a payment that never completed.

## Options for the issued-invoice guard

**A. Session flag, verified by a deferred check (recommended).** The payment code sets `medcore.payment_change = 'on'` with `set_config(..., true)` inside its transaction, just before it changes the invoice status. The `medcore_invoice_rules` guard allows a status change only when that flag is on. A deferred constraint trigger on `payments` checks at commit that the invoice status equals the status implied by the sum of `SUCCEEDED` payments, and that the sum never exceeds the total. A bug that changes status without the right payments fails at commit.

**B. Database-derived status.** A trigger updates the invoice status itself whenever a payment changes. No application code needs to know the rules, but the status logic lives only in SQL and is harder to test from TypeScript.

**C. Remove the guard for statuses.** Rejected. It would undo the M-11b protection that issued documents are immutable.

Recommendation: **A**. It keeps the rules checkable in both places, and the application code that sets the flag already exists (`syncInvoiceStatus` in `payments.service.ts`).

## Verification before approval (must be done by the reviewer)

1. Confirm the live enum and table names. The draft assumes Prisma's default names: `"PaymentStatus"`, `"PaymentMethod"`, `payments`, `invoices`, and the M-11b function `medcore_invoice_rules`. Check them against `20261119220000_invoice_integrity/migration.sql` and the database.
2. `ALTER TYPE ... ADD VALUE` cannot be used inside the same transaction that uses the new value. The draft does not use it in a function body, but confirm how Prisma runs the file.
3. Run the migration on a throwaway copy of the database first, then run the rollback, then the migration again.
4. Confirm `pg_trigger` shows `payments_invoice_status` after install, so the API gate opens.

## Files

- `migration.sql`: draft, not applied.
- `rollback.sql`: draft, not applied.
- `schema.diff`: the matching `schema.prisma` changes, not applied.

Approval of M-12 is a separate decision. Please reply with the option (A is recommended) and whether the migration may be applied to the development database.

## Review against the current schema (2026-11-22)

Fixed in this revision:

1. The first draft defined a separate guard function that was never attached to a trigger, and left M-11b's `medcore_invoice_rules` refusing every status change. M-12 now replaces `medcore_invoice_rules` (copied from M-11b with only the issued-status rule changed), and also drops `status` from the frozen-columns comparison, which would otherwise have refused the same change.
2. `reversedById` had no foreign key and `schema.diff` had no `reversedBy` relation or `User` back-relation. Both added, matching the `(id, hospitalId)` pattern of `receivedById`.
3. The transition function compared against `'REVERSED'` as an enum literal; it now compares `status::text`, so it compiles while the new value is uncommitted.
4. Added: no deletes, a positive amount, reversal fields all-or-none, no reversal or un-reconciling of a reconciled payment, and reconciliation only of received payments. These mirror the API checks.
5. Removed the explicit `BEGIN`/`COMMIT`.

Still to check on a throwaway database: Prisma's transaction handling of `ALTER TYPE ... ADD VALUE`, and that `payments_invoice_status` appears in `pg_trigger` afterwards.

## Validation on a scratch database (2026-11-22, Phase 13)

Applied after all ten committed migrations and the M-11b validation seed, on a scratch PostgreSQL 16 database. Then rolled back and applied again. M-11b's own behaviour suite still passes in full with M-12, M-13 and M-15 on top (111 of 111).

Fixed in this revision:

- `payments_reversal_complete` allowed status REVERSED with no reversal fields. It now ties the fields to the status.
- A duplicate positive-amount check was removed; M-11b's `payments_amount_chk` already enforces it.
