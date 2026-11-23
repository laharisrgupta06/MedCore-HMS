# MedCore HMS — Project Memory

**Read this first when resuming.** Facts only; details live in the linked documents. Last updated:
2026-11-19 (IST), Phase 7 Done, Phase 8 in progress, M-11a moved into the project and waiting for approval to apply.

## Project

Multi-tenant hospital management platform built from the original PRD ([PRD.md](PRD.md), original in
[prd/](prd/)). Goal: the complete application per the roadmap, not a prototype. Owner: Lahari. Developer:
Claude (main session acting as Team Lead).

## Current state

| Area | Status |
| --- | --- |
| Phase | **5: Done** (2026-11-16 22:42, M-05 applied). **6: Done** (2026-11-16 23:15; M-06 applied; DEC-041 queue fix verified on macOS). **7: Done** (2026-11-17 15:34; M-07..M-10 applied on macOS, drift empty, integration 19/19, Playwright 50/50). **8: In Progress** (plan approved 2026-11-17 19:09, DEC-045..054; M-11a tax configuration (revision 4, DEC-055..059) validated on PostgreSQL 16 and moved into `prisma/migrations` (local commit 2026-11-19), **not applied on macOS**, waiting for approval). P14-09 separate database accounts is mandatory. Branch `feat/phase-1-auth`; nothing pushed |
| Phase 0 | Done and verified (VM + macOS). Open: CI never run on GitHub; browser checks of status page and Swagger UI |
| Database | Schema revision 2 + DEC-031 declarations. Initial migration `20261116085814_init` **applied on macOS** by the owner; drift (4 SQL-only keys) fixed in schema.prisma (DEC-031), drift now empty. All unit + 4 integration suites pass on macOS (14:53). Migration 2 `20261116092500_hospital_id_db_default` (DEC-032, approved) created, not yet applied. No other migrations |
| Backend | Foundation + Phase 1B auth (register, email/phone OTP, login, refresh rotation, logout one/all, forgot/reset, me, CSRF, auth rate limit, RBAC guard, audit of auth events, create-super-admin CLI). Phase 1C: tenant context + scoped Prisma client, permissions matrix, audit interceptor, users endpoints. Verified only with in-memory Prisma/Redis. Phase 2 org modules. **Phase 3** `modules/appointments`: schedules, exceptions, cached slots, locked booking, lifecycle, emergency, reminders (DEC-038), `GET /doctors/me` |
| Frontend | **Phase 1D built**: tokens in Tailwind 4 `@theme`, base components (button, field, alert, logo), public home, status, privacy, terms, 404, favicon; sign-in, register, verify email, forgot/reset; in-memory session store with silent refresh, cross-tab lock and logout sync; protected staff/patient shells; account page (profile, phone verification, sign out everywhere). E2E written, not yet run; Phase 2 org screens; **Phase 3**: staff day agenda with status actions, reception booking (incl. emergency), availability management, patient portal booking and list. All appointment times in hospital time |
| Tests | API unit 1277 (1072-case matrix) + web 55 (VM). Last macOS run (Phase 7, 2026-11-17 15:34): integration 11/11 suites, 19/19 tests; Playwright 50/50. Details: [TEST_PLAN.md](TEST_PLAN.md) |
| Working mode | Single session, permanently (owner, 15:28). `.claude/agents/*` and `team-kickoff.md` are unused and untracked |

## Git

- Repo: `github.com/laharisrgupta06/MedCore-HMS`. **Nothing pushed**; `origin/main` = `2e1ed21`.
- Current branch `feat/phase-0-scaffold` (also contains Phase 1A work). Other local branches: `main`, `chore/housekeeping` (`88234ee`).
- Commits: `4a780d2` source docs · `88234ee` checklist · `ab76eda` Phase 0 · `5571fe2` types build fix · `14abf1e` Mac verification · `8576b24` schema draft · `e487298` schema revision 2 · `e6d567a` documentation system.
- Untracked, owner's file: `Claude outputs/schema-revision-2.diff` (leave alone).
- Commit identity used: "Lahari Gupta" with the repository's existing author email; the build VM needs delete permission so git can remove its lock files.

## Pending owner decisions and approvals

1. **"Approve schema"** (DEC-019) → then run the migration commands on macOS (P1A-04).
2. ~~Design tokens~~: approved (DEC-033).
3. Agent Teams (DEC-034): owner fixes Mac sign-in, confirms Opus 5.5 in `/model`, launches with `.claude/team-kickoff.md`.
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

1. Phase 8: owner approval to apply M-11a on macOS (commands: [migration-review.md](migration-review.md) section 11). Until then `migrate deploy` shows it pending and M-11a integration tests fail. Then M-11b, M-12, M-13, M-14, each drafted, validated and approved separately (TASKS 8-A2..8-A5), with the billing code (8-B1..8-B12). Accountant review is a mandatory production-release gate (8-G1).
   Proposed migrations live in `apps/api/prisma/proposed/<name>/` with their test changes until moved into the project; Prisma never reads that folder.
2. Carried forward from Phase 7: development API stop before the 14:57 Playwright run not diagnosed (capture the log if it recurs); P14-09 separate database accounts (mandatory).
3. Carried forward: seed data (P14); legal review of Privacy/Terms; Swagger UI check; key rotation (R-04).

## Document map

[PRD](PRD.md) · [ARCHITECTURE](ARCHITECTURE.md) · [RULES](RULES.md) · [DESIGN](DESIGN.md) · [TASKS](TASKS.md) ·
[TEST_PLAN](TEST_PLAN.md) · [SECURITY](SECURITY.md) · [DECISIONS](DECISIONS.md) · reference:
[implementation-roadmap](implementation-roadmap.md), [database-schema](database-schema.md),
[frontend-design-system](frontend-design-system.md), [phase-0-checklist](phase-0-checklist.md),
[agent-teams-reference](agent-teams-reference.md)
