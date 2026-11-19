# M-11b invoice_integrity: proposal (not applied, not in prisma/migrations)

Task 8-A2. Implements DEC-051 (line snapshots and arithmetic), DEC-052 (gap-free numbering per series),
DEC-053 (issued documents immutable; correction requests), DEC-058 (line lock protocol), Q19 A
(late-charge invoices), Q2 B, Q4 A, Q6 A in the database.

| File | What |
| --- | --- |
| `migration.sql` | The migration (920 lines). Additive; stops if billing tables hold rows |
| `rollback.sql` | Exact rollback for an unused database; refuses if billing rows exist |
| `schema.prisma`, `schema.diff` | Proposed Prisma schema and its diff against the current one |
| `validation/` | Scratch PostgreSQL 16 validation; `results.txt` is the last full run |

Validation (2026-11-19, PostgreSQL 16.15): 111 PASS, 0 FAIL. Safety 8/8 (precondition, existing rows
identical by data dump, rollback refusal, rollback restores `pg_dump -s` exactly, re-apply), behaviour
94/94, concurrency 9/9 (50 concurrent finalises gap-free; lines wait for open registration and
assignment writers and then match committed values; finalise versus line; concurrent draft creation),
conformance 416/416 (`schema.prisma` against the migrated database).

Object totals after M-11b: 55 tables (+4), 64 triggers (+11), 3 exclusion constraints.

## Before applying on macOS (open items for the owner)
1. `test/constraints.int-spec.ts` (T-MIG-006) creates one draft invoice per `pnpm test:int` run in an
   integration-test hospital, and integration runs keep their rows, so the development database is
   expected to hold such invoices. M-11b stops on any invoice row. A read-only count is needed first;
   removing those test rows needs the owner's explicit approval (no data is deleted without it).
2. At activation T-MIG-006 is replaced (it writes totals into a draft, which M-11b refuses), and the
   constraints.int-spec counts change to 55 tables and 64 triggers by adding names, never removing checks.
