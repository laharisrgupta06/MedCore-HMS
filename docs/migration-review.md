# MedCore HMS — Initial Migration Review Package (P1A-04)

**Status: initial migration `20261116085814_init` applied by the owner on macOS (2026-11-16, 14:33 report).** Drift check found 4 objects; resolved in the schema file by DEC-031, re-check pending (section 8).
Prepared 2026-11-16 on branch `feat/phase-1-auth`. Schema: revision 2 (`e487298`), unchanged since.
Approval phrase: "approve schema" (DEC-019). Until then no migration file exists in the repository.

## 1. What the migration will create

The initial migration is the whole schema: Prisma's generated DDL followed by
`apps/api/prisma/sql/constraints.sql` appended at the end of the same file.

| Part | Source | Content (counted from the files) |
| --- | --- | --- |
| Tables | `schema.prisma` | 44 models → 44 tables (snake_case via `@@map`) |
| Enum types | `schema.prisma` | 36 |
| Tenant columns | `schema.prisma` | `hospitalId` on 41 tables (37 required, 4 optional: users, notifications, notification_deliveries, audit_logs); 3 global tables: hospitals, icd10_codes, webhook_events |
| Composite tenant foreign keys | `schema.prisma` | 85 relations `(xId, hospitalId) → (id, hospitalId)`, backed by `@@unique([id, hospitalId])` on 27 referenced models (DEC-018) |
| Extensions | `constraints.sql` | `pgcrypto` (encryption at rest, Phase 4), `btree_gist` (exclusion constraints) |
| CHECK constraints | `constraints.sql` | users hospital scope, tax rate, schedules, appointment times, vitals ranges, 20 MB files, pharmacy quantities, lab ranges/prices/values, invoice/payment/claim amounts, correction reasons, status actor/reason |
| Exclusion constraints | `constraints.sql` | no overlapping active appointments per doctor (emergencies excluded) and per patient |
| Extra indexes | `constraints.sql` | `users_email_lower_key` (case-insensitive email), partial unique `family_history_patient_condition_original_key` |
| SQL-only same-tenant keys | `constraints.sql` | hospitals → addresses, notifications → recipient user, notification_deliveries → notifications, plus `notifications (id, hospitalId)` unique |
| Triggers and functions | `constraints.sql` | 31 triggers, 9 functions: role/profile consistency for all 9 roles (deferred to COMMIT), correction parent checks, append-only clinical tables and audit log, status-only updates for patient history, closed medical records locked, approved lab orders/results locked, amended lab orders validated |

`constraints.sql`: 367 lines, 82 statements; parsed by the PostgreSQL parser (pglast) with
identifiers cross-checked against the schema (T-STA-004). **It has never been executed by PostgreSQL** (R-01).

## 2. Schema diff

- Revision 1 draft → revision 2: `git diff 8576b24 e487298 -- apps/api/prisma`
  (schema.prisma +502/−… lines, constraints.sql +257 lines; 587 insertions, 172 deletions in total).
  The same diff is in `Claude outputs/schema-revision-2.diff`.
- Revision 2 contents (approved designs): clinical corrections that keep originals (DEC-016), the seven PRD
  gap fixes (DEC-017), composite tenant keys (DEC-018). Human-readable description and ER diagrams:
  [database-schema.md](database-schema.md).
- Since `e487298` the schema has **not changed** (Phases 1B/1C used it as is).

## 3. Generated SQL: how it will be produced and what to check

Prisma's engines cannot be downloaded in the build VM or the cloud workspace (`binaries.prisma.sh` returns
403), so the DDL can only be generated on macOS. Step 1 below prints it without touching any database.
Review checklist for the generated part:

1. 36 `CREATE TYPE … AS ENUM` and 44 `CREATE TABLE` statements; every `id` is `UUID`, timestamps `TIMESTAMPTZ(3)`.
2. Every tenant table has `"hospitalId" UUID` (`NOT NULL` except the 4 optional ones).
3. Composite foreign keys appear as `FOREIGN KEY ("xId", "hospitalId") REFERENCES "…"("id", "hospitalId")` with
   `ON DELETE RESTRICT` (or `CASCADE` where the schema says so); expect 85 of them.
4. Unique indexes `…_id_hospitalId_key` exist on the 27 referenced tables.
5. No `DROP` statements (it is an initial migration).
6. The appended `constraints.sql` comes **after** all generated statements (it references the tables).

## 4. Steps (run on macOS from the repository root, only after approval)

```bash
# 0. Services up and healthy
pnpm infra:up && pnpm infra:ps

# 1. Preview the generated DDL (read-only, no database changes)
pnpm --filter @medcore/api prisma:preview-sql > /tmp/medcore-init-preview.sql
grep -c 'CREATE TABLE' /tmp/medcore-init-preview.sql      # expect 44
grep -c 'CREATE TYPE' /tmp/medcore-init-preview.sql       # expect 36
grep -c 'FOREIGN KEY' /tmp/medcore-init-preview.sql       # expect 85 + single-column FKs
grep -c 'DROP' /tmp/medcore-init-preview.sql              # expect 0

# 2. Create the migration file without applying it
pnpm --filter @medcore/api prisma:migrate:create --name init

# 3. Append the database constraints to that file
cat apps/api/prisma/sql/constraints.sql >> apps/api/prisma/migrations/*_init/migration.sql

# 4. Review the complete file (checklist in section 3), then stop and report back
wc -l apps/api/prisma/migrations/*_init/migration.sql

# 5. Apply to the local database (this is the irreversible step for the local DB)
pnpm --filter @medcore/api prisma:migrate

# 6. Read-only drift check: prints what Prisma would change to match schema.prisma
pnpm --filter @medcore/api prisma:drift
```

Steps 2–4 change only files; step 5 changes the local database. If step 5 fails, the transaction is rolled
back by PostgreSQL; copy the error and do not edit the database by hand.

## 5. Verification after step 5

```bash
# Database objects (counts only; no data, no secrets)
docker compose -f docker/compose.dev.yml --env-file .env exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "
  SELECT count(*) FROM information_schema.tables WHERE table_schema = '"'"'public'"'"' AND table_name <> '"'"'_prisma_migrations'"'"';
  SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal;
  SELECT count(*) FROM pg_constraint WHERE contype = '"'"'x'"'"';
  SELECT extname FROM pg_extension ORDER BY 1;"'
# expect: 44 tables, 31 triggers, 2 exclusion constraints, extensions include btree_gist and pgcrypto

# Redis and Mailpit
docker compose -f docker/compose.dev.yml --env-file .env exec redis redis-cli ping     # PONG
curl -s http://localhost:8025/api/v1/info | head -c 200; echo                           # Mailpit JSON

# All automated integration tests: health, throttler, auth (Mailpit OTP), tenancy (real FKs)
pnpm test:int

# Unit tests, lint, types (should already pass)
pnpm test && pnpm lint && pnpm typecheck

# Optional manual check: start the API, then open http://localhost:3001/api/docs and http://localhost:8025
pnpm --filter @medcore/api dev
curl -s http://localhost:3001/api/health
```

`pnpm test:int` currently fails on purpose with "Initial migration not applied (P1A-04)" for the auth and
tenancy suites; after step 5 all four suites must pass. The integration tests create rows prefixed `int-`
in the local database; audit rows are append-only by design and stay.

## 6. Risks and mitigations

| ID | Risk | Likelihood / impact | Mitigation |
| --- | --- | --- | --- |
| M-01 | `constraints.sql` has never run on PostgreSQL (R-01): a runtime error (e.g. a type mismatch in a trigger) is still possible | Medium / blocks step 5 | The migration is one transaction: failure leaves the DB unchanged. Fix in `constraints.sql`, regenerate the migration file (not yet applied, so editing it is allowed) |
| M-02 | **Drift (confirmed):** Prisma wanted to drop the 3 SQL-only foreign keys and the `notifications (id, hospitalId)` unique. CHECK, exclusion constraints, triggers and the expression/partial indexes were not reported | Occurred / would have silently removed tenant guarantees | **Resolved by DEC-031**: the four objects are declared in `schema.prisma` with identical names; `sql-drift.spec.ts` guards it. Still every migration `--create-only` + review (RULES.md) |
| M-03 | Deferred role/profile trigger errors surface at COMMIT, not at the failing insert | Low / confusing error | Code creates user + profile in one transaction (registration, CLI, staff onboarding in Phase 2); tests cover it (T-AUTH-INT-001, T-TEN-INT-001) |
| M-04 | Append-only `audit_logs` with `ON DELETE RESTRICT` to users and hospitals: those rows can never be hard-deleted | By design / test data accumulates | Users are soft-deleted; local cleanup is `prisma migrate reset` (destroys all local data, needs explicit approval) |
| M-05 | `migrate dev` needs a shadow database (CREATE DATABASE privilege) | Low locally (container user is superuser) | Production uses `prisma migrate deploy`, which needs no shadow database |
| M-06 | Managed PostgreSQL in production must allow `pgcrypto` and `btree_gist` | Low (both are trusted extensions on PostgreSQL ≥ 13 and available on AWS RDS) | Check in Phase 14 before the first deploy |
| M-07 | Case-insensitive email index and Prisma's own unique on `email` both exist | None functionally | The API stores emails lower-cased; the expression index also blocks case variants written by other code |
| M-08 | Enum literals in CHECK/EXCLUDE expressions (`'CANCELLED'`, `'EMERGENCY'`) must match enum labels exactly | Low (cross-checked) | Step 5 fails loudly if not (M-01) |
| M-09 | Local data loss when re-running from scratch | Only with `prisma migrate reset` | Never run without explicit approval |

## 7. What happens after approval

1. You run steps 0–4 and share the step 1 counts and any review findings (or ask me to review the file).
2. You run step 5 and step 6 and share the output of step 6 and of `pnpm test:int`.
3. I record the results (TEST_PLAN T-MIG-001..006, T-AUTH-INT-001, T-TEN-INT-001), fix anything that fails,
   commit the migration file, and mark Phases 1A–1C Done.

## 8. Drift finding and next verification (2026-11-16)

`prisma:drift` after applying the migration listed DROPs for exactly the four Prisma-managed objects that
only `constraints.sql` created. They are intentional (DEC-018) and stay. Fix (DEC-031): `schema.prisma`
now declares them with the same names, columns, `onDelete` and `onUpdate: NoAction`, so Prisma's model
matches the database. No database change and no new migration.

Next safe commands (all read-only except `prisma:generate`, which only rewrites the generated client in
`node_modules`):

```bash
pnpm --filter @medcore/api prisma:drift     # expected: "-- This is an empty migration."
pnpm --filter @medcore/api prisma:generate  # client now knows the declared relations
pnpm test && pnpm test:int                  # unit + PostgreSQL/Redis/Mailpit integration suites
```

If `prisma:drift` still prints statements, copy them back; do not run `prisma:migrate` (it would create
and apply a migration from them).

## 9. First integration run (14:41) and fix

`prisma:drift` was empty. `test:int`: health passed; auth, tenancy and constraints failed at
`prisma.hospital.create()` with `Null constraint violation on the fields: (id)`. Root cause and fix: DEC-032
(interim: explicit hospital ids in the tests; permanent: a one-line default migration awaiting approval).
The SQL behaviour the suites test was checked beforehand on a disposable PostgreSQL 16 loaded with the
applied migration (TEST_PLAN T-SIM-001). Next run:

```bash
pnpm test && pnpm test:int
```

## 10. Migration 2: `20261116092500_hospital_id_db_default` (DEC-032, approved 14:53)

```sql
ALTER TABLE "hospitals" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
```

Review:
- Changes only the column default: no `DROP`, no data rewrite, no row touched, no constraint changed
  (a brief lock on `hospitals` while the catalog is updated). `gen_random_uuid()` is built into PostgreSQL 13+.
- `schema.prisma`: `Hospital.id` uses `@default(dbgenerated("gen_random_uuid()"))`; `prisma validate` passes.
- Checked on a disposable PostgreSQL 16 loaded with the applied init migration: migration applies; the
  existing hospital row is byte-identical before and after (md5 of all rows); an insert without an id
  returns a UUID; 4 hospital constraints and 31 triggers unchanged.
- Written by hand because Prisma's engine cannot run here; it is the statement Prisma emits for this
  schema change. Step 1 below proves it before anything is applied.

Commands (macOS, repository root):

```bash
pnpm --filter @medcore/api prisma:generate
pnpm --filter @medcore/api prisma:drift      # BEFORE applying: expect exactly the ALTER ... SET DEFAULT gen_random_uuid() line
pnpm --filter @medcore/api prisma:deploy     # applies only the pending migration; creates nothing, no shadow DB
pnpm --filter @medcore/api prisma:drift      # AFTER: expect "-- This is an empty migration."
pnpm test && pnpm test:int                   # includes T-MIG-008: hospital created without an id
```

If the first drift output differs from that single statement, stop and send it; do not deploy.

