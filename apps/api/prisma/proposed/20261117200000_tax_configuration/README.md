# Proposed migration M-11a: tax configuration (not applied)

Status: **drafted and validated on PostgreSQL 16 only. Not in `prisma/migrations`, not applied to any
owner database.** Approved for drafting and validation by the owner on 2026-11-17 19:09 (DEC-055);
applying it needs a separate approval.

Prisma reads migrations only from `prisma/migrations` and the schema only from `prisma/schema.prisma`, so
nothing in this folder affects the application, `prisma migrate`, the integration tests or the drift check
until it is moved into place.

| File                                  | Becomes, on approval                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migration.sql`                       | `apps/api/prisma/migrations/20261117200000_tax_configuration/migration.sql`                                                                        |
| `schema.prisma`                       | `apps/api/prisma/schema.prisma` (the change is shown in `schema.diff`)                                                                             |
| `tests/constraints.int-spec.ts`       | `apps/api/test/constraints.int-spec.ts` (counts 51 tables, 50 triggers, 3 exclusions, plus M-11a names; diff in `tests/constraints.int-spec.diff`) |
| `tests/tax-configuration.int-spec.ts` | `apps/api/test/tax-configuration.int-spec.ts` (new)                                                                                                |
| `tests/tenant-scope.spec.ts`          | `apps/api/src/common/tenancy/tenant-scope.spec.ts` (47 scoped models, 4 global; diff in `tests/tenant-scope.spec.diff`)                            |
| `rollback.sql`                        | Stays here. Manual reversal for review only; never run without approval                                                                            |
| `validation/`                         | Stays here. Record of the PostgreSQL 16 validation                                                                                                 |

The test changes are kept here because they describe the database after M-11a: moved early, they would
fail on a database without it.

Review notes and macOS commands: [docs/migration-review.md](../../../../../docs/migration-review.md),
section 11.
