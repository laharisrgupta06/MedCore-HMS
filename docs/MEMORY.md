# MedCore HMS — Project Memory

**Read this first when resuming.** Facts only; details live in the linked documents. Last updated:
2026-11-16 (IST), end of documentation-system setup.

## Project

Multi-tenant hospital management platform built from the original PRD ([PRD.md](PRD.md), original in
[prd/](prd/)). Goal: the complete application per the roadmap, not a prototype. Owner: Lahari. Developer:
Claude (main session acting as Team Lead).

## Current state

| Area | Status |
| --- | --- |
| Phase | **1A, database schema: in review**. Next executable task: P1A-04 (migration) after "approve schema" |
| Phase 0 | Done and verified (VM + macOS). Open: CI never run on GitHub; browser checks of status page and Swagger UI |
| Database | Schema revision 2 written and validated: 44 models, 36 enums, 85 composite tenant FKs, constraints.sql (syntax-checked). **No migrations exist; nothing applied** |
| Backend | Foundation only: health endpoint, envelopes, validation, sanitised logging, Redis rate limiting, BullMQ, Swagger. No auth yet |
| Frontend | Foundation only: same-origin proxy, API client, service status page. **Design tokens proposed, not approved** ([DESIGN.md](DESIGN.md)) |
| Tests | 41 API unit + 7 web pass (VM); 2 integration pass (Mac). Details: [TEST_PLAN.md](TEST_PLAN.md) |
| Agent Teams | Not in use. See team section |

## Git

- Repo: `github.com/laharisrgupta06/MedCore-HMS`. **Nothing pushed**; `origin/main` = `2e1ed21`.
- Current branch `feat/phase-0-scaffold` (also contains Phase 1A work). Other local branches: `main`, `chore/housekeeping` (`88234ee`).
- Commits: `4a780d2` source docs · `88234ee` checklist · `ab76eda` Phase 0 · `5571fe2` types build fix · `14abf1e` Mac verification · `8576b24` schema draft · `e487298` schema revision 2 · (next) documentation system.
- Untracked, owner's file: `Claude outputs/schema-revision-2.diff` (leave alone).
- Commit identity used: "Lahari Gupta" with the repository's existing author email; the build VM needs delete permission so git can remove its lock files.

## Pending owner decisions and approvals

1. **"Approve schema"** (DEC-019) → then run the migration commands on macOS (P1A-04).
2. **Design tokens** in [DESIGN.md](DESIGN.md) (blocks P1D).
3. **Agent Teams** (DEC-022): fix local Claude Code authentication (`401 User not found` via OpenRouter) and approve the team plan below, or continue solo.
4. Acknowledge implementation-level decisions DEC-014, DEC-015, DEC-020, DEC-023, DEC-025 (currently Proposed).
5. Branch strategy: suggested new branch `feat/phase-1-auth` before Phase 1B.
6. Part 8 of the latest instruction was cut off; resend if it adds rules.

## Known issues and constraints

- Build VM: Node 22, no Docker, `binaries.prisma.sh` blocked (Prisma migrate/generate run on Mac; validation runs offline in the VM). Working copy at `~/work/medcore` in the VM; source is synced to the repo without `node_modules`.
- macOS: npm global prefix is `~/.npm-global` (pnpm 11.28.12); Docker Desktop 29.9.3.
- Risks: [SECURITY.md](SECURITY.md) R-01..R-07.

## Proposed Agent Team (not spawned; awaiting DEC-022)

| Teammate | Owns | Model (proposed) | Effort | Mode | Active in |
| --- | --- | --- | --- | --- | --- |
| Team Lead (main session) | Root configs, `packages/types`, `docker/`, `.github/`, `.env.example`, `docs/` (except database-schema.md) | Opus-class | high | Plans, integrates, reviews | Always |
| db-engineer | `apps/api/prisma/**`, `docs/database-schema.md` | Opus-class (tenancy and integrity are high-risk) | high | Plan first | Only when the schema changes |
| backend-engineer | `apps/api/src/**` except `infra/prisma/schema-tenancy.spec.ts` | Opus-class for auth/RBAC/tenancy/billing, Sonnet-class for CRUD modules | high / medium | Plan first for security modules | 1B onward |
| frontend-engineer | `apps/web/**` | Sonnet-class | medium | Plan first; must read DESIGN.md and frontend-design-system.md in full | After design approval (1D onward) |
| qa-engineer | `apps/api/test/**`, `e2e/**`, `*.spec.ts`/`*.test.*` it creates, `docs/TEST_PLAN.md` | Sonnet-class | medium | Implement directly | 1B onward |

Model availability through OpenRouter is **unverified**. With newer models the shared task list needs
`CLAUDE_CODE_ENABLE_TODO_TOOLS=1` ([agent-teams-reference.md](agent-teams-reference.md) §10). Start with at most
two or three active teammates to control token cost.

## Next actions

1. Owner: reply "approve schema" (or request changes).
2. Run on macOS: `prisma:migrate:create --name init`, append `prisma/sql/constraints.sql`, review, `prisma:migrate`; then T-MIG-001..006.
3. Phase 1B authentication backend (P1B-01..11).
4. Design approval, then Phase 1D.

## Document map

[PRD](PRD.md) · [ARCHITECTURE](ARCHITECTURE.md) · [RULES](RULES.md) · [DESIGN](DESIGN.md) · [TASKS](TASKS.md) ·
[TEST_PLAN](TEST_PLAN.md) · [SECURITY](SECURITY.md) · [DECISIONS](DECISIONS.md) · reference:
[implementation-roadmap](implementation-roadmap.md), [database-schema](database-schema.md),
[frontend-design-system](frontend-design-system.md), [phase-0-checklist](phase-0-checklist.md),
[agent-teams-reference](agent-teams-reference.md)
