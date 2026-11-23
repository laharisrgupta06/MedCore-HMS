# M-11a: tax configuration — review and validation record

Status: **revision 4, validated on PostgreSQL 16 and moved into the project on 2026-11-19 (local commit, not
pushed). Not yet applied to the owner's database**; applying it needs the owner's separate approval
(DEC-055). The active copies are listed below; this folder keeps the record of what was reviewed and
validated. Prisma never reads this folder.

| File                                  | Active copy (moved 2026-11-19)                                                                                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migration.sql`                       | `apps/api/prisma/migrations/20261117200000_tax_configuration/migration.sql`                                                                                                                                                                                                                             |
| `schema.prisma`                       | `apps/api/prisma/schema.prisma` (the change is shown in `schema.diff`)                                                                                                                                                                                                                                  |
| `tests/constraints.int-spec.ts`       | `apps/api/test/constraints.int-spec.ts` (counts 51 tables, 53 triggers, 3 exclusions, plus M-11a names; diff in `tests/constraints.int-spec.diff`)                                                                                                                                                      |
| `tests/tax-configuration.int-spec.ts` | `apps/api/test/tax-configuration.int-spec.ts` (new)                                                                                                                                                                                                                                                     |
| `tests/tenant-scope.spec.ts`          | `apps/api/src/common/tenancy/tenant-scope.spec.ts` (47 scoped models, 4 global; diff in `tests/tenant-scope.spec.diff`)                                                                                                                                                                                 |
| `tests/schema-tenancy.spec.ts`        | `apps/api/src/infra/prisma/schema-tenancy.spec.ts` (51 models; `StatutoryRoomTaxRule` documented as global; diff in `tests/schema-tenancy.spec.diff`)                                                                                                                                                   |
| `rollback.sql`                        | Stays here. Manual reversal for review only; never run without approval                                                                                                                                                                                                                                 |
| `validation/`                         | Stays here. Record of the PostgreSQL 16 validation (`results-rev4.txt`, `gstin_reference.md`)                                                                                                                                                                                                           |
| `docs.patch`                          | Changes to `docs/` for revisions 2 to 4 (DEC-055..059, TASKS 8-A1, 8-A2, 8-B2 and P14-09, SECURITY R-15 and R-16, TEST_PLAN, migration-review section 11, ARCHITECTURE 6h, MEMORY). Applied to `docs/` on 2026-11-19; kept as the record                                                                |
| `review-rev4-vs-rev3.diff`            | Stays here. Revision 3 to revision 4 diff of every file that changed, as reviewed on 2026-11-19 (before the runner fix below and before activation)                                                                                                                                                     |
| `review-rev3-vs-fc76ded.diff`         | Stays here. Review snapshot (2026-11-18 23:18 IST) of this folder against commit `fc76ded` (revision 1). Revision 3 only: taken before revision 4 and the 2026-11-19 documentation corrections, so it no longer matches `migration.sql`, the tests, the validation scripts, `docs.patch` or this README |

The copies here are identical to the active ones (checked by SHA-256 when they were moved). Until M-11a is
applied on macOS, `prisma migrate deploy` lists it as pending and the integration tests that need it fail.

`validation/run_all.sh` was corrected on 2026-11-19: its "existing rows unchanged" step could pass when the
scratch rebuild or the migration itself had failed. The recorded runs are unaffected (both logs show the
migration applied); an independent re-run from these files gave the same 199 passes and no failures.

Review notes and macOS commands: [docs/migration-review.md](../../../../../docs/migration-review.md),
section 11.
