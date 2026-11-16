# MedCore HMS — Development Rules

Apply to the main session and every Agent Team teammate. Source hierarchy: (1) original PRD,
(2) approved roadmap and owner decisions ([DECISIONS.md](DECISIONS.md)), (3) approved architecture and design
specifications, (4) existing implementation and verified tests, (5) proposals, which must be labelled as such.

## Before any change

1. Read [MEMORY.md](MEMORY.md) first, then the documents relevant to the task.
2. Identify the requirement IDs ([PRD.md](PRD.md)) and task IDs ([TASKS.md](TASKS.md)).
3. Check `git status` and the current branch. Never discard uncommitted work.

## General

- Never invent requirements, endpoints, database fields, credentials or results. Missing documents are reported, not reconstructed.
- No AI or LLM APIs, SDKs or AI-dependent features in the application (DEC-002).
- Do not change approved technology choices or major versions without an approved decision (DEC-001, DEC-014).
- Reuse existing components, utilities and services; no duplicate implementations.
- Do not modify unrelated files; keep changes minimal and targeted.
- Follow existing conventions: TypeScript strict, Prettier (single quotes, 100 columns), ESLint flat config, Nest module per feature, `@medcore/types` for API contracts, PRD response envelope.
- Never hardcode secrets; configuration only through validated environment variables; no secrets in `NEXT_PUBLIC_*`.
- Never claim something works without running it; say where it was verified (build VM, macOS, CI).
- Ask the owner when a decision affects architecture, security, scope, accounts, payments or secrets.

## Database

- The Database Engineer owns `apps/api/prisma/**` (DEC-008). Others request changes by message.
- Every hospital-specific table has `hospitalId`; tenant relations are composite `(id, hospitalId)` keys (DEC-018). `schema-tenancy.spec.ts` must pass.
- Never edit an applied migration; add a new one. Production uses `prisma migrate deploy` only.
- Any foreign key or unique constraint written in SQL must also be declared in `schema.prisma` with the same name (`map:`); Prisma drops undeclared ones (DEC-031, `sql-drift.spec.ts`).
- Every migration is created with `--create-only` and reviewed before it is applied; remove any `DROP` of an object from `prisma/sql/constraints.sql` (Prisma does not model them), and run `pnpm --filter @medcore/api prisma:drift` afterwards ([migration-review.md](migration-review.md)).
- Clinical data is never deleted or overwritten; corrections follow DEC-016.
- No raw SQL at runtime except the approved pgcrypto helpers (DEC-024) and the health probe.

## Backend

- Every endpoint: DTO validation, `@Roles()`, tenant scoping, Swagger decorators, audit entry for writes, happy-path and error-path tests.
- `hospitalId` comes only from the verified token. Tenant data is read and written only through `TenantPrismaService.client`; `PrismaService` directly is reserved for auth, system jobs and platform-level (global) tables.
- Every new route gets a row in `docs/permissions-matrix.csv` (the matrix test fails otherwise); write routes get `@Audit(action, entity, safeFields)` or are audited generically. Never pass request bodies, personal or clinical values to the audit log (DEC-030).
- Errors use the envelope and common codes; never leak internals.
- External services only through adapter interfaces with local implementations (DEC-003).

## Frontend

- Follow [DESIGN.md](DESIGN.md) and [frontend-design-system.md](frontend-design-system.md) in full. No styled screen before design tokens are approved.
- Call the API only through `lib/api-client.ts`; never invent endpoints or response shapes; never show success the backend did not confirm.
- Hiding UI is not security; the backend enforces access.
- No placeholder pages, dead links, non-functional buttons, fake statistics or fake patient data. No emoji icons, purple gradients or em dashes in user-facing copy.

## Collaboration (Agent Teams)

- Each teammate has exclusive file ownership (see [MEMORY.md](MEMORY.md) team section). Shared files (root configs, `packages/types`, `.env.example`, `docker/`, `.github/`) are changed only by the Team Lead.
- Agree API contracts and schema changes before integration; announce deliverables, contract changes, blockers and security concerns.
- Do not overwrite another teammate's work. The Team Lead integrates, reviews and resolves conflicts.

## Git

- Never push, force-push, reset, rebase published history or delete branches without explicit owner approval.
- Inspect the diff before every commit; meaningful messages; generated files, build output and secrets stay out of Git.
- Do not commit unapproved schema or design changes as if approved; label drafts in the commit message.
- Git in the build VM needs delete permission for its lock files; never leave stale `.lock` files.

## Quality

- Type-safe code; validate all external input; handle errors explicitly.
- New functionality ships with tests; format, lint, typecheck and tests pass before a task is marked Done.
- A task is Done only when implementation and its required verification pass ([TASKS.md](TASKS.md)); record actual results in [TEST_PLAN.md](TEST_PLAN.md).
- Mock data is only for clearly labelled development fixtures and tests.

## Documentation

Keep the nine documents synchronised. Update by change type:

| Change | Update |
| --- | --- |
| Requirement | PRD, TASKS, TEST_PLAN |
| Architecture, API, module | ARCHITECTURE, DECISIONS, TASKS, TEST_PLAN, MEMORY |
| Schema or migration | database-schema, ARCHITECTURE, DECISIONS, SECURITY (if relevant), TASKS, TEST_PLAN |
| Coding convention | RULES |
| Design | DESIGN |
| Security control or risk | SECURITY, TEST_PLAN |
| Progress, tests, session end | TASKS, TEST_PLAN, MEMORY |
