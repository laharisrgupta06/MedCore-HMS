# M-11b invoice_integrity, revision 2: proposal (not applied, not in prisma/migrations)

Task 8-A2. Implements DEC-051 (line snapshots and arithmetic), DEC-052 (gap-free numbering per series),
DEC-053 (issued documents immutable; correction requests), DEC-058 (line lock protocol), Q19 A
(late-charge invoices), Q2 B, Q4 A, Q6 A in the database.

| File                           | What                                                                   |
| ------------------------------ | ---------------------------------------------------------------------- |
| `migration.sql`                | The migration (920 lines). Additive; stops if billing tables hold rows |
| `rollback.sql`                 | Exact rollback for an unused database; refuses if billing rows exist   |
| `schema.prisma`, `schema.diff` | Proposed Prisma schema and its diff against the current one            |
| `validation/`                  | Scratch PostgreSQL 16 validation; `results.txt` is the last full run   |

Revision 2 (owner decisions of 2026-11-19 21:44, DEC-066; diff in `review-rev2-vs-rev1.diff`):

- Decision 4: voiding a draft releases its sources. Lines gain `releasedAt` (set only by the void of
  their draft, from inside the database, to its `voidedAt`; refused for direct updates, drafts, issued
  invoices, a second release and inserts) and `consultationAppointmentId`. The initial "billed once,
  ever" unique indexes on lab order item and dispense are replaced by partial unique indexes over
  unreleased lines, plus one for consultations, so a replacement draft can bill the same consultation,
  lab item and dispense and no source is ever on two live lines. Voided invoices and lines are kept.
- Decision 7: series prefixes are unique per hospital and financial year as well as per scope and year
  (`document_number_series_hospitalId_financialYear_prefix_key`, which also binds series opened by hand);
  the automatic prefix chooser checks both.

Validation of revision 2 (2026-11-19 21:48, PostgreSQL 16.15): 130 PASS, 0 FAIL. Safety 8/8
(precondition, existing rows identical by data dump, rollback refusal, rollback restores `pg_dump -s`
exactly, re-apply), behaviour 111/111 (adds the replacement workflow for consultation, lab and pharmacy,
release protections, unregistered-to-regular and GSTIN changes, document types, series opened by hand,
16-character maximum), concurrency 11/11 (adds a replacement draft racing an open void, committed and
rolled back), conformance 427/427.

Object totals after M-11b: 55 tables (+4), 64 triggers (+11), 3 exclusion constraints.

## Before applying on macOS (open items for the owner)

1. `test/constraints.int-spec.ts` (T-MIG-006) creates one draft invoice per `pnpm test:int` run in an
   integration-test hospital, and integration runs keep their rows, so the development database is
   expected to hold such invoices. M-11b stops on any invoice row. A read-only count is needed first;
   removing those test rows needs the owner's explicit approval (no data is deleted without it).
2. At activation T-MIG-006 is replaced (it writes totals into a draft, which M-11b refuses), and the
   constraints.int-spec counts change to 55 tables and 64 triggers by adding names, never removing checks.
