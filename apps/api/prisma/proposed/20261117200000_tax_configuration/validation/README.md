# M-11a validation (build environment, PostgreSQL 16.15)

These scripts were used to validate M-11a in the build environment before approval. Paths refer to
that workspace (`/home/claude/m11a`, staged migrations under `/mnt/user-data/uploads`); they are kept
as a record of exactly what was run, not as project tooling.

| Script                                  | What it checks                                                                                                                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rebuild.sh`                            | Fresh scratch database from the ten applied migrations plus `seed.sql` (two hospitals, admins, a lab test, a medicine, two rooms)                                                                                                       |
| `behaviour_tests.py`                    | 79 rule checks, each in its own rolled-back transaction                                                                                                                                                                                 |
| `rollback_checks.sh`                    | Atomicity (injected failure), re-apply refusal, manual reversal, reversal guard                                                                                                                                                         |
| `conform.js`                            | 195 comparisons between the proposed Prisma schema (via Prisma's own schema WebAssembly, engine c2990dca) and the migrated database: columns, types, nullability, defaults, keys, unique indexes, foreign keys and actions, enum values |
| `dataq.sql`, `dataq_old.sql`, `dump.sh` | Row hashes and schema dumps used for before/after comparisons                                                                                                                                                                           |
