# M-13 proposal: settle insurance claims into the patient balance (NOT APPLIED, NOT VALIDATED)

> 2026-11-23: moved into `prisma/migrations/20261122110000_tpa_settlement/` with its schema.prisma change, after validation on a disposable database. Not yet applied to the owner's development database; that needs the owner's separate approval.

Status: design APPROVED (2026-11-22). Migration NOT APPLIED; nothing here has been run against any database.

## Why M-13 is needed

Claim tracking (PRD 7.7) works without this migration: claims are submitted, approved or rejected, and settled amounts are recorded on the claim (`insurance_claims`). Those settlements do not reduce the patient's balance, because `PaymentMethod` has no value for a TPA payment. Without M-13, the accountant must settle the balance by cash or online payment after the TPA pays the hospital, and the claim record and the receipt are not linked.

## What M-13 adds

1. `PaymentMethod` gains `TPA_SETTLEMENT`, so a TPA payment is an ordinary payment row with its own method.
2. Once applied, code can record a TPA settlement against the invoice through the same transaction, lock and invoice-status sync as cash. The claim moves to `SETTLED` in that transaction.

## What is not affected

- Claim tracking, decisions and the claims queue are complete without M-13.
- The issued-invoice rules are unchanged. M-13 does not touch M-11b or M-12.

## Dependencies

- M-12 must be approved first, because a TPA settlement is a payment and must follow the payment rules.
- The Prisma schema must add `TPA_SETTLEMENT` to `PaymentMethod` in the same change, or reads of such rows will fail.

## Code prepared for it

`POST /api/claims/:id/settle` with `postToBalance: true` calls `PaymentsService.postTpaSettlement`. In one transaction it locks the invoice, checks that M-12 is installed (the `payments_invoice_status` trigger exists) and that M-13 is installed (`TPA_SETTLEMENT` exists in `pg_enum`), and checks the claim is approved, the amount is at most the claim and the balance, and no checkout is open. It then inserts the TPA payment, marks the claim settled and syncs the invoice status. Before then it answers `503 TPA_SETTLEMENT_PENDING` and changes nothing. Without `postToBalance`, settlement stays tracking-only.

## Review against the current schema (2026-11-22)

1. `schema.prisma` must gain `TPA_SETTLEMENT` in the same change. Until it does, Prisma cannot read a TPA payment row, so the insert uses raw SQL and reads must wait for the schema change.
2. `@medcore/types` `PAYMENT_METHODS` and `PAYMENT_METHOD_LABEL` must gain `TPA_SETTLEMENT` with the schema change. Until then, the reconciliation filter deliberately does not offer it, because Prisma would reject the value.
3. M-12's consistency trigger counts TPA rows like any received payment, and its transition rules allow inserting them as `SUCCEEDED`, so no M-12 change is needed.
4. A TPA row has `provider` and `providerReference` NULL, which matches the existing columns. `receivedById` is the accountant who posted it.
5. `insurance_claims` has no link to the payment row. Traceability comes from the same transaction and the audit log. A `paymentId` column on the claim would make it explicit, which is optional and not in this draft.

## Validation on a scratch database (2026-11-22, Phase 13)

The first draft only added the enum value. Testing on a scratch PostgreSQL 16 database showed that M-11b's `payments_provider_chk` (a provider is required unless the method is CASH) rejects every TPA settlement, because a TPA payment has no provider. This revision replaces that check so TPA settlements are treated like cash. With it, a TPA settlement inserts, moves the invoice to PARTIALLY_PAID and passes M-12's commit-time check.
