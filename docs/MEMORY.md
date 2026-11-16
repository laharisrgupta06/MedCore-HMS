# MedCore HMS — Project Memory

**Read this first when resuming.** Facts only; details live in the linked documents. Last updated:
2026-11-16 (IST), Phase 1B authentication backend implemented.

## Project

Multi-tenant hospital management platform built from the original PRD ([PRD.md](PRD.md), original in
[prd/](prd/)). Goal: the complete application per the roadmap, not a prototype. Owner: Lahari. Developer:
Claude (main session acting as Team Lead).

## Current state

| Area | Status |
| --- | --- |
| Phase | **1B + 1C: Review** on branch `feat/phase-1-auth` (commits `d5354ac` Phase 1B, `d91b7b9` Phase 1C). 1A still awaits "approve schema" → P1A-04 migration. Next independent work: blocked on approvals (see below) |
| Phase 0 | Done and verified (VM + macOS). Open: CI never run on GitHub; browser checks of status page and Swagger UI |
| Database | Schema revision 2 written and validated: 44 models, 36 enums, 85 composite tenant FKs, constraints.sql (syntax-checked). **No migrations exist; nothing applied** |
| Backend | Foundation + Phase 1B auth (register, email/phone OTP, login, refresh rotation, logout one/all, forgot/reset, me, CSRF, auth rate limit, RBAC guard, audit of auth events, create-super-admin CLI). Phase 1C: tenant context + scoped Prisma client, permissions matrix, audit interceptor, users endpoints. Verified only with in-memory Prisma/Redis |
| Frontend | Foundation only: same-origin proxy, API client, service status page. **Design tokens proposed, not approved** ([DESIGN.md](DESIGN.md)) |
| Tests | 288 API unit + 7 web pass (VM); 2 integration pass (Mac); auth, tenancy and constraint integration tests (T-AUTH-INT-001, T-TEN-INT-001, T-MIG-001..006) written, not run (need migration). Audit entries store field names only (DEC-030). Details: [TEST_PLAN.md](TEST_PLAN.md) |
| Agent Teams | **Abandoned** by the owner (13:46): single session only. Untracked `.claude/agents/*` and `.claude/team-kickoff.md` from the abandoned setup are not used and not committed |

## Git

- Repo: `github.com/laharisrgupta06/MedCore-HMS`. **Nothing pushed**; `origin/main` = `2e1ed21`.
- Current branch `feat/phase-0-scaffold` (also contains Phase 1A work). Other local branches: `main`, `chore/housekeeping` (`88234ee`).
- Commits: `4a780d2` source docs · `88234ee` checklist · `ab76eda` Phase 0 · `5571fe2` types build fix · `14abf1e` Mac verification · `8576b24` schema draft · `e487298` schema revision 2 · `e6d567a` documentation system.
- Untracked, owner's file: `Claude outputs/schema-revision-2.diff` (leave alone).
- Commit identity used: "Lahari Gupta" with the repository's existing author email; the build VM needs delete permission so git can remove its lock files.

## Pending owner decisions and approvals

1. **"Approve schema"** (DEC-019) → then run the migration commands on macOS (P1A-04).
2. **Design tokens** in [DESIGN.md](DESIGN.md) (blocks P1D).
3. ~~Agent Teams~~: abandoned; work continues in this single session.
4. Acknowledge implementation-level decisions DEC-014, DEC-015, DEC-020, DEC-023, DEC-025 (currently Proposed).
5. Branch `feat/phase-1-auth` created from `feat/phase-0-scaffold` at `7cd5957`.
6. Part 8 of the latest instruction was cut off; resend if it adds rules.

## Known issues and constraints

- Build VM: Node 22, no Docker, `binaries.prisma.sh` blocked (Prisma migrate/generate run on Mac; validation runs offline in the VM). Working copy at `~/work/medcore` in the VM; source is synced to the repo without `node_modules`.
- macOS: npm global prefix is `~/.npm-global` (pnpm 11.28.12); Docker Desktop 29.9.3.
- Risks: [SECURITY.md](SECURITY.md) R-01..R-07.

## Agent Teams

Abandoned by the owner on 2026-11-16 13:46 (DEC-022 superseded in practice). Single-session development only.

## Next actions

1. Owner: review [migration-review.md](migration-review.md), reply "approve schema" (or request changes). Phase 2 must not start before this (owner, 14:17).
2. Run on macOS: `prisma:migrate:create --name init`, append `prisma/sql/constraints.sql`, review, `prisma:migrate`; then T-MIG-001..006 and `pnpm test:int` (includes T-AUTH-INT-001).
3. Phase 2 (hospital onboarding, departments, staff, doctors, patients, beds) needs the migrated database to be verified; backend code can proceed, but the auth screens (1D) need design approval.
4. Design approval, then Phase 1D auth screens.

## Document map

[PRD](PRD.md) · [ARCHITECTURE](ARCHITECTURE.md) · [RULES](RULES.md) · [DESIGN](DESIGN.md) · [TASKS](TASKS.md) ·
[TEST_PLAN](TEST_PLAN.md) · [SECURITY](SECURITY.md) · [DECISIONS](DECISIONS.md) · reference:
[implementation-roadmap](implementation-roadmap.md), [database-schema](database-schema.md),
[frontend-design-system](frontend-design-system.md), [phase-0-checklist](phase-0-checklist.md),
[agent-teams-reference](agent-teams-reference.md)
