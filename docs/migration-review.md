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


## 11. Migration M-11a: `20261117200000_tax_configuration` (DEC-045 to DEC-050, DEC-055)

Status: **revision 4, validated on PostgreSQL 16 and moved into the project (local commit 2026-11-19, not
pushed); not applied to the owner's database; waiting for the owner's separate approval.**
Files: `apps/api/prisma/migrations/20261117200000_tax_configuration/migration.sql`; review and validation
record in `apps/api/prisma/proposed/20261117200000_tax_configuration/` (README lists every file).

### What it adds

| Object | Detail |
| --- | --- |
| Enums | `TaxSupplyType` (GOODS, SERVICE), `TaxTreatment` (EXEMPT, NIL_RATED, TAXABLE), `GstRegistrationType` (REGULAR, COMPOSITION, UNREGISTERED), `CriticalCareUnit` (ICU, CCU, ICCU, NICU) |
| `tax_classifications` | Per hospital; unique (id, hospitalId), (hospitalId, name); FKs hospital, (createdById, hospitalId) → users; CHECKs name 1–120 characters, code 4/6/8 digits, SAC codes start with 99 exactly for services |
| `tax_classification_versions` | Per hospital; unique (id, hospitalId), (classificationId, effectiveFrom); FKs hospital, (classificationId, hospitalId), (createdById, hospitalId); CHECK rate 0 unless TAXABLE (then above 0, at most 40), no tax inside the price unless TAXABLE |
| `hospital_tax_defaults` | Primary key (hospitalId, kind); kind CONSULTATION or LAB; FKs hospital, (classificationId, hospitalId), (updatedById, hospitalId) |
| `hospital_gst_registrations` | Per hospital; unique (id, hospitalId), (hospitalId, effectiveFrom); FKs hospital, (attestedById, hospitalId); CHECK details by type with `medcore_gstin_valid` and state code = GSTIN prefix; exclusion constraint: one GSTIN, one hospital |
| `statutory_room_tax_rules` | Platform data (no hospitalId); unique effectiveFrom; CHECK values; seeded: 18 July 2022, ₹5,000.00, 5%, SAC 9993, tax added on top |
| New columns | `lab_tests.taxClassificationId`, `medicines.taxClassificationId` (nullable, composite FK to the same hospital's classification), `rooms.criticalCareUnit` (nullable), `hospitals.taxSetupConfirmedAt/ById` (both or neither; same-tenant FK), `hospitals.taxTimezoneLockedAt` (nullable; stamped by the first tax date, DEC-057) |
| Functions (9) | `medcore_tax_clock` (the database clock, `clock_timestamp()`), `medcore_tax_date` (the hospital's tax date: its local date ten minutes ahead of the clock; the first call stamps the time zone lock), `medcore_gstin_valid`, and six trigger functions |
| Triggers (11) | `tax_classifications_rules` (no delete; only name and active flag change; a default's classification stays active); `tax_classification_versions_rules`, checked again at commit by the deferred `tax_classification_versions_rules_at_commit` (a new version needs an active classification, DEC-059; no start before the tax date; once a version is in force the next starts after the tax date, DEC-056; changed or deleted only before it starts; locks the hospital row, then the classification row, DEC-058); `hospital_gst_registrations_rules`, checked again at commit by the deferred `hospital_gst_registrations_rules_at_commit` (never edited; no start before the tax date; same-day rule; deleted only before it starts; locks the hospital row); `hospitals_tax_timezone` (time zone and lock stamp fixed once stamped, DEC-057); `statutory_room_tax_rules_append_only`; `lab_tests_tax_classification` and `hospital_tax_defaults_classification` (active service classification); `medicines_tax_classification` (active goods classification); these three lock the hospital row and then write the classification row unchanged, so an assignment and a deactivation cannot interleave (DEC-058); `hospital_tax_defaults_no_delete` |

No index is added for the two nullable lab test and medicine foreign keys: classification lookups go from
the item to the classification, and both tables are small per hospital. Revisit with M-11b if invoice
building needs the reverse lookup.

### Effect on existing data and behaviour

- No existing row changes. The new columns are nullable with no default, so adding them rewrites nothing
  (catalog-only change, brief lock per table).
- The three new triggers on `lab_tests` and `medicines` fire only when the classification column is set or
  changed, so Phase 6 and Phase 7 writes are unaffected (checked: price and reorder-level updates).
- The tenant-scoped Prisma client scopes the four new hospital tables automatically (they have
  `hospitalId`); the room rule is global reference data.
- The whole file is one implicit transaction: any failure leaves no trace.

### Validation (PostgreSQL 16.15, revision 4, 2026-11-19; T-MIG-TAX-001, T-MIG-TAX-TIME-001, T-MIG-TAX-CLS-001)

Full record: `validation/results-rev4.txt` in the proposal folder (migration md5 `fa23da93…`, SHA-256
`6dd4848f…`; `rollback.sql` and `schema.prisma` unchanged since revision 3). `results-rev3.txt` is kept as the
revision 3 record.

- The eight migrations in `prisma/migrations` applied to a scratch database, then rows of the kinds M-11a
  touches seeded (two hospitals with admins and staff profiles, a lab test, a medicine, a private room and an
  ICU room).
- M-11a applied as one multi-statement query (as Prisma sends it): existing rows identical by hash
  (excluding the new, empty columns); new columns empty; room rule seeded once.
- 120 behaviour checks, each in its own rolled-back transaction with a simulated clock where needed:
  classifications 16, versions 21 (including the five DEC-059 rules), tax date and midnight 13, production
  clock 2, defaults and confirmation 11, GST registrations 29 (including the same GSTIN refused for another
  hospital), time zone lock 11, item classifications 9, rooms and room rule 6, existing tables 2. All pass.
- 19 classification race tests (`classification_race_tests.sh`, revision 4): assignment and new version
  against deactivation, both orders, at all three isolation levels; lab test and medicine assignment; lock
  order; no blocking of plain reads or foreign-key inserts; rehearsal of T-MIG-TAX-013; a control with
  revision 3's assignment check reproduces the race (both commit) at READ COMMITTED and REPEATABLE READ.
- 3 tests under a real `COMMIT` (commit-time checks); 6 two-session races between a time zone change and the
  first version or registration at READ COMMITTED, REPEATABLE READ and SERIALIZABLE; 11 timing and lock
  tests (`timing_tests.sh`, see below) and the `FOR SHARE NOWAIT` rehearsal of T-MIG-TAX-011; timing test 8
  and the rehearsal are also run against a control copy with the writer locks removed, which shows the gap.
  The two-session race for one GSTIN in two hospitals was run in revision 1; the exclusion constraint it
  exercises has not changed since.
- GSTIN: 32 checks against python-stdnum 2.2 and real issued GSTINs (`validation/gstin_reference.md`).
- Rollback: 7 checks. Injected failure at the end leaves schema and data identical; re-running on a migrated
  database fails on the first statement and changes nothing; the manual reversal (`rollback.sql`) restores the
  exact pre-M-11a schema and data and removes the migration record; it refuses, changing nothing, while any tax
  configuration exists, while any statutory rule other than the seeded one exists, or when the seeded row has
  been altered; a time zone lock left by since-deleted future rows does not block it.
- Prisma: the proposed `schema.prisma` validates with Prisma's own schema WebAssembly (engine `c2990dca`,
  Prisma 6.19.3; the CLI cannot run here because `binaries.prisma.sh` is blocked) and has 51 models and 41
  enums; 198 of 198 comparisons between that schema and the migrated database match (columns, types,
  nullability, defaults, keys, unique indexes, foreign keys and their delete and update actions, enum values).
  The authoritative drift check runs on macOS (below).
- VM (2026-11-19), with M-11a revision 4 moved into place in the VM copy only (migration, proposed schema
  and the four test files) and a client generated from the proposed schema: typecheck, lint and format
  clean; API unit tests 1278/1278 (the extra test is the drift check on the new migration; T-TEN-001: 47
  scoped models, 4 global; T-TEN-001d: 51 models). The VM was then restored to the current schema (1277/1277).
- Object counts after M-11a, measured with T-MIG-001's own queries: 51 tables, 53 triggers, 3 exclusion
  constraints (before: 46, 42, 2). The 17 named M-11a objects (5 tables, 11 triggers, 1 exclusion constraint)
  are all present. Revision 4 creates the same 116 objects as revision 3.
- Not run here: the proposed integration tests (T-MIG-001, T-MIG-TAX-002..013, T-TEN-001d against a real
  database) and the drift check, which run on macOS after applying (below); the two-session race for one
  GSTIN in two hospitals (revision 1 only, see above); the reverse-order deadlock case in R-16.

### Revisions 2 and 3 (owner reviews 2026-11-18)

Revision 2: tax date with a ten-minute margin and commit-time rechecks; same-day rule (DEC-056); time zone
lock (DEC-057); rollback guard checks the seeded room rule is unchanged; GSTIN verified independently
(DEC-048). Revision 3: writer row locks, hospital row first (DEC-058). Revision 4: assignments serialise
with deactivation (DEC-058); new versions need an active classification (DEC-059).

### What the time checks guarantee, and what they do not

| Question | Answer (demonstrated in `validation/timing_tests.sh`) |
| --- | --- |
| Can a transaction pass its commit-time check and commit more than ten minutes later? | Yes. Deferred triggers run before the commit record is flushed and before any synchronous-replication wait; neither has a time limit. |
| What happens if the database stalls during commit? | The writer has passed every check and waits; its change is invisible until the stall ends, then visible at once. A reader without locks meanwhile sees the old data; a reader taking `FOR SHARE` waits and then sees the final data. |
| Does `SET CONSTRAINTS ALL IMMEDIATE` bypass the protection? | Yes, genuinely: it runs the commit-time check at that moment, and the transaction may commit any time later. |
| What timeout controls exist? | PostgreSQL 16: `statement_timeout`, `idle_in_transaction_session_timeout` (demonstrated), `lock_timeout`, plus Prisma transaction timeouts. No limit on total transaction time until PostgreSQL 17 (`transaction_timeout`). None bounds a commit stalled in storage or replication. |
| Can it be made stronger without unacceptable complexity? | Yes, by row locks (revision 3): consistency between issued lines and committed tax data no longer depends on timing. The midnight boundary itself remains best effort. |

Guarantee, stated precisely: an issued invoice line always matches the tax data committed at the moment
its own transaction obtained its locks (provided M-11b takes them, 8-A2, and nobody bypasses triggers as a
superuser, R-11). Whether an edit that lands within minutes of midnight is accepted is a ten-minute safety
margin under normal operation, **not an absolute guarantee**.

### Rollback behaviour

1. **During application:** automatic. One transaction; a failure rolls everything back and Prisma records the
   attempt as failed in `_prisma_migrations`. Send the error; do not edit the database by hand. Clearing the
   failed record (`prisma migrate resolve --rolled-back`) is done only after the error is reviewed.
2. **After a successful application:** Prisma has no down migrations. `rollback.sql` is a reviewed, tested
   reversal for emergencies, run only with the owner's approval and only while no tax configuration and no
   later statutory rule exists and the seeded room rule is unchanged (it refuses otherwise). Once billing
   uses these tables, a mistake is corrected by a new migration, never by reversal.
3. **Last resort:** restore the backup taken in step 1 below, with approval.

### macOS commands (only after the owner approves applying M-11a)

The files are already in place (local commit of 2026-11-19, nothing pushed): the migration in
`prisma/migrations/20261117200000_tax_configuration/`, the new `schema.prisma`, and the four test files.
From the repository root:

```bash
# 0. The expected commit, a clean tree (apart from your untracked .claude/ and "Claude outputs/"), services up
git log --oneline -1
git status --short
pnpm infra:up && pnpm infra:ps

# 1. Backup of the local database (contains patient data: keep it outside the repository; delete when done)
docker compose -f docker/compose.dev.yml --env-file .env exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > ~/medcore-before-m11a.dump
ls -lh ~/medcore-before-m11a.dump

# 2. Read-only: the last applied migration (expect 20261117100000_prescription_events)
docker compose -f docker/compose.dev.yml --env-file .env exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1"'

# 3. Client from the new schema
pnpm --filter @medcore/api prisma:generate

# 4. Read-only drift BEFORE applying: only additions, no DROP
pnpm --filter @medcore/api prisma:drift > /tmp/m11a-drift-before.sql
grep -c '^CREATE TABLE' /tmp/m11a-drift-before.sql   # expect 5
grep -c '^CREATE TYPE' /tmp/m11a-drift-before.sql    # expect 4
grep -c 'DROP' /tmp/m11a-drift-before.sql            # expect 0

# 5. Apply the one pending migration (no shadow database, no reset)
pnpm --filter @medcore/api prisma:deploy

# 6. Read-only drift AFTER: expect "-- This is an empty migration."
pnpm --filter @medcore/api prisma:drift

# 7. Tests: unit, integration (12 suites including T-MIG-TAX-002..013), then Playwright with the stack running
pnpm test && pnpm test:int
pnpm --filter @medcore/e2e test:e2e
```

If step 4 shows any `DROP`, or counts other than 5 and 4, stop before step 5 and send the output.
