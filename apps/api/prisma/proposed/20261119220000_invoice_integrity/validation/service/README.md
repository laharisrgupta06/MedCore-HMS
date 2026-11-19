# Billing service on PostgreSQL 16 (harness)

`run.ts` runs the real `BillingService` (apps/api/src/modules/billing) against a scratch copy of the
M-11b validation database (`validation/seed.sql` + the nine earlier migrations + M-11b revision 2),
through the same tenant scoping as the API (`scopeArgs`), with every trigger active. It uses an
engine-free Prisma 6.19.3 client generated from the committed `schema.prisma` (driver adapter `pg`).

Covered: automatic consultation, lab and pharmacy charges with tax snapshots; accountant discount
(half-up shares); void and replacement re-billing all three released charges (decision 4); finalise
with gap-free numbering and document type; issued documents immutable; late-charge invoice with a
manual room charge; correction request and accountant note; patient and hospital isolation; lab
cancellation removing a draft charge; empty draft refused.

Last run 2026-11-19: 24/24 service checks passed. The macOS equivalent runs through the API in
`test/invoices.int-spec.ts` once M-11b is applied there.
