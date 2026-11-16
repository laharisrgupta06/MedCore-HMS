# MedCore HMS — Master Task Tracker

Owners: **LEAD** (Team Lead/Architect), **DB** (Database Engineer), **BE** (Backend), **FE** (Frontend),
**QA** (Testing). Until Agent Teams are verified and approved (DEC-022) the main session performs all roles.
Status: Not Started · In Progress · Blocked · Review · Done. **Done = implemented and required verification
passed** (environment recorded in [TEST_PLAN.md](TEST_PLAN.md)). Phases follow
[implementation-roadmap.md](implementation-roadmap.md). Last updated 2026-11-16.

## Progress summary

| Phase | Scope | Tasks | Done | Status |
| --- | --- | --- | --- | --- |
| 0 | Foundation | 16 | 13 | **Done** except CI run on GitHub (P0-14) and two browser checks (P0-15, P0-16) |
| 1A | Database schema | 7 | 2 | **Review**: awaiting "approve schema", then migration on macOS |
| 1B | Authentication | 12 | 0 | **Review**: P1B-01..12 implemented and unit/HTTP-tested (VM); database integration tests wait for the migration (P1A-04) |
| 1C | RBAC and tenancy | 7 | 0 | **Review**: P1C-01..06 implemented, 285 API tests pass (VM); PostgreSQL tests wait for the migration; P1C-07 needs an approved push |
| 1D | Auth frontend | 6 | 0 | Blocked: design approval |
| 2–14 | Remaining modules, hardening, deployment | 75 | 0 | Not Started |

## Phase 0 — Foundation

| Task ID | Req. | Task | Owner | Deps | Priority | Status | Tests | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0-01 | SCOPE-001 | pnpm workspace, root scripts, Node pin | LEAD | — | Critical | Done | T-STA-001/002 | `ab76eda` |
| P0-02 | DEP-003 | Prettier, ESLint, strict TypeScript, VS Code settings | LEAD | P0-01 | High | Done | T-STA-001 | |
| P0-03 | API-002..005 | `@medcore/types`: envelopes, roles, pagination, health | LEAD | P0-01 | Critical | Done | T-ENV-010..012 | prepare build fix `5571fe2` |
| P0-04 | TECH-020, API-001..004 | NestJS app setup: prefix, Helmet, CORS, validation, envelope, filter | BE | P0-03 | Critical | Done | T-API-*, T-ERR-*, T-VAL-* | |
| P0-05 | SEC-003, DEP-002 | Startup environment validation | BE | P0-04 | Critical | Done | T-ENV-001..006 | |
| P0-06 | AUTH-012 | Log sanitiser | BE | P0-04 | High | Done | T-LOG-* | |
| P0-07 | SEC-005, CACHE-003 | Redis-backed rate limiting (1000/min) | BE | P0-04 | High | Done | T-RL-*, T-INT-002 (Mac) | Auth limit in P1B-09 |
| P0-08 | TECH-021/023/026 | Prisma, Redis, BullMQ wiring | BE | P0-04 | Critical | Done | T-INT-001 (Mac) | |
| P0-09 | SCOPE-001 | `GET /api/health` | BE | P0-08 | High | Done | T-HLT-*, T-INT-001 (Mac) | |
| P0-10 | API-006 | Swagger at `/api/docs` | BE | P0-04 | Medium | Done | T-API-009 | UI not yet viewed in a browser |
| P0-11 | TECH-010..018, DEC-004 | Next.js 15 app, same-origin proxy, API client, status page | FE | P0-03 | Critical | Done | T-WEB-* | |
| P0-12 | SCOPE-001, DEP-001 | Docker Compose dev: PostgreSQL 16, Redis 7, Mailpit | LEAD | — | Critical | Done | T-STA-005 (Mac) | Ports on 127.0.0.1 |
| P0-13 | DEP-002 | `.env.example`, local `.env` | LEAD | P0-05 | Critical | Done | Manual | |
| P0-14 | DEP-003 | GitHub Actions CI workflow | LEAD | P0-02 | High | Review | Not run on GitHub | Needs approved push |
| P0-15 | SCOPE-001 | Browser check: status page through proxy | QA | P0-11 | Medium | Not Started | Owner check | Not blocking |
| P0-16 | API-006 | Browser check: Swagger UI | QA | P0-10 | Low | Not Started | Owner check | Not blocking |

## Phase 1A — Database schema

| Task ID | Req. | Task | Owner | Deps | Priority | Status | Tests | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1A-01 | SCOPE-002, DB-001..019 | Complete schema, 44 models, 36 enums | DB | — | Critical | Review | T-STA-003, T-DB-001..004 | `8576b24`, `e487298` |
| P1A-02 | DEC-016..018 | Corrections, gap fixes, composite tenant keys | DB | P1A-01 | Critical | Review | T-DB-*, T-STA-004 | Approved designs; schema approval pending |
| P1A-03 | DB-014, EMR-002, APPT-006 | `constraints.sql`: CHECKs, exclusions, triggers | DB | P1A-01 | Critical | Review | T-STA-004 (syntax only) | Not executed by PostgreSQL yet |
| P1A-04 | DB-020 | Create initial migration on macOS, append constraints, review SQL ([migration-review.md](migration-review.md)) | DB | owner "approve schema" | Critical | Review: applied by owner (`20261116085814_init`); drift fixed in schema (DEC-031), drift re-check pending | T-MIG-001 | DEC-019, DEC-025 |
| P1A-05 | DB-001..019 | Database constraint tests against real PostgreSQL | QA | P1A-04 | Critical | Review (written: `test/constraints.int-spec.ts`; not run) | T-MIG-002..006 | |
| P1A-06 | DEL-004 | ER diagrams | DB | P1A-01 | Medium | Done | Review | Mermaid in `database-schema.md`; Prisma-generated ER at deliverable stage |
| P1A-07 | TEN-002 | Schema tenancy guard test | QA | P1A-01 | High | Done | T-DB-001..004 (VM) | Negative check performed |

## Phase 1B — Authentication (backend)

| Task ID | Req. | Task | Owner | Deps | Priority | Status | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1B-01 | AUTH-001, DEC-010, DEC-012 | Register with hospital code, password policy | BE | P1A-04 | Critical | Review | T-AUTH-002 |
| P1B-02 | AUTH-006, DEC-011 | Email OTP (hashed in Redis, TTL, attempts) delivered to Mailpit | BE | P1B-01 | Critical | Review | T-AUTH-003 |
| P1B-03 | AUTH-007, DEC-011 | Phone OTP via dev-only SMS inbox adapter (Twilio adapter for production) | BE | P1B-01 | High | Review | T-AUTH-004 |
| P1B-04 | AUTH-002, AUTH-011 | Login: bcrypt 12, access JWT 15 min, refresh cookie 7 days | BE | P1B-01 | Critical | Review | T-AUTH-005 |
| P1B-05 | AUTH-003, AUTH-010, SEC-004 | Refresh rotation with reuse detection | BE | P1B-04 | Critical | Review | T-AUTH-001 |
| P1B-06 | AUTH-008 | Logout one device / all devices | BE | P1B-05 | High | Review | T-AUTH-006 |
| P1B-07 | AUTH-004/005 | Forgot and reset password (single-use, revokes sessions) | BE | P1B-04 | High | Review | T-AUTH-007 |
| P1B-08 | AUTH-009 | `GET /auth/me` with role permissions | BE | P1B-04 | High | Review | T-AUTH-008 |
| P1B-09 | SEC-005 | Auth rate limit 100 / 15 min per IP | BE | P1B-04 | High | Review | T-AUTH-009 |
| P1B-10 | SEC-010 | CSRF token for state-changing requests | BE | P1B-04 | High | Review | T-AUTH-010 |
| P1B-11 | DEC-013 | `create-super-admin` CLI | BE | P1A-04 | High | Review | T-AUTH-011 |
| P1B-12 | API-012 | `GET/PATCH/DELETE /users/:id`, `GET /users` | BE | P1C-02 | Medium | Review | T-RBAC-001 |

Phase 1B notes (branch `feat/phase-1-auth`): "Review" = implemented and unit/HTTP-tested in the VM with
in-memory Prisma and Redis; not Done until `test/auth.int-spec.ts` (T-AUTH-INT-001) passes on macOS against
PostgreSQL, Redis and Mailpit, which needs the initial migration. Endpoint additions: DEC-028.

## Phase 1C — RBAC, tenancy, audit

| Task ID | Req. | Task | Owner | Deps | Priority | Status | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1C-01 | ROLE-010 | JWT guard, `@Public()`, `@Roles()` guard, `@CurrentUser()` | BE | P1B-04 | Critical | Review | T-RBAC-001 |
| P1C-02 | TEN-003/004 | Tenant context + Prisma extension; audited Super Admin client | BE | P1C-01 | Critical | Review | T-TEN-001 |
| P1C-03 | ROLE-011 | `docs/permissions-matrix.csv` and generated matrix test | QA | P1C-01 | Critical | Review | T-RBAC-001 |
| P1C-04 | TEST-010, TEST-016 | Route-level tenancy isolation suite as required CI check | QA | P1C-02 | Critical | Review | T-TEN-001 |
| P1C-05 | SEC-012 | Audit interceptor for writes and auth events | BE | P1C-02 | High | Review | T-AUD-001 |
| P1C-06 | — | Update docs (ARCHITECTURE, SECURITY, TEST_PLAN, MEMORY) | LEAD | P1C-05 | High | Review | Review |
| P1C-07 | DEP-003 | CI green on GitHub (after approved push) | LEAD | P1C-04 | High | Blocked (push approval) | CI |

Phase 1C notes: tenant context (AsyncLocalStorage) + `TenantGuard` + `TenantPrismaService` (Prisma query
extension) ; Super Admin uses the unscoped client and every such request is audited (`super_admin.read`,
`crossTenant: true`); `AuditInterceptor` logs every successful write; `docs/permissions-matrix.csv` drives
`src/permissions-matrix.spec.ts` (172 cases, also checks every registered route is listed); isolation tests
in `users.http.spec.ts` (VM) and `test/tenancy.int-spec.ts` (PostgreSQL, not yet run). The isolation tests
run in CI with the rest of the suite once pushed (P1C-07).

### Open blockers (2026-11-16)

| # | Blocker | Needs | Unblocks |
| --- | --- | --- | --- |
| B-1 | Migration verification | Owner runs `prisma:drift` (expect empty), `prisma:generate`, `pnpm test:int` ([migration-review.md](migration-review.md) §8) | P1A-04/05, Done for 1B/1C (T-AUTH-INT-001, T-TEN-INT-001, T-MIG-*), Phase 2 |
| B-2 | Design tokens | Owner approval of [DESIGN.md](DESIGN.md) | Phase 1D and every styled screen |
| B-3 | CI on GitHub | Owner approval to push | P0-14, P1C-07 |
| B-4 | Browser checks | Owner opens the status page and Swagger UI | P0-15, P0-16 |
| B-5 | Proposed decisions | Owner acknowledgement of DEC-014/015/020/023/025..030 | Records only; not blocking code |
| B-6 | Part 8 of the documentation instruction was cut off | Owner resends if it adds rules | — |

## Phase 1D — Authentication frontend

| Task ID | Req. | Task | Owner | Deps | Priority | Status | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1D-01 | Part 11 | Design tokens approved ([DESIGN.md](DESIGN.md)) | LEAD | owner | Critical | Blocked (approval) | — |
| P1D-02 | Part 11 | Tokens in Tailwind/Shadcn, base components | FE | P1D-01 | Critical | Not Started | T-FE-* |
| P1D-03 | FE-002, AUTH-001/006 | `(auth)`: login, register, verify email/phone | FE | P1D-02, P1B | Critical | Not Started | T-FE-*, T-E2E-001 |
| P1D-04 | AUTH-004/005 | Forgot and reset password screens | FE | P1D-02, P1B-07 | High | Not Started | T-FE-* |
| P1D-05 | AUTH-003, TECH-018 | Auth store, silent refresh, role redirect, logout | FE | P1D-03 | Critical | Not Started | T-FE-* |
| P1D-06 | DEC-009 | Custom 404, Privacy, Terms (legal review flagged) | FE | P1D-02 | Medium | Not Started | T-FE-* |

## Phases 2–14 (from the roadmap; detailed breakdown added when each phase starts)

| Task ID | Req. | Task | Owner | Priority | Status |
| --- | --- | --- | --- | --- | --- |
| P2-01..06 | SCOPE-005/006, ROLE-001/002, API-013/014/015 | Hospital onboarding and verification; departments; staff; doctors (signature upload); patients (MRN); rooms and beds | BE, FE | Critical | Not Started |
| P3-01..08 | SCOPE-007..009, APPT-001..006, CACHE-002 | Weekly availability, exceptions, slots (60 s cache), booking with locks, status lifecycle, emergency, reminders 24 h/1 h, booking UI | BE, FE, QA | Critical | Not Started |
| P4-01..08 | SCOPE-010/011, EMR-001..012, SEC-013/014 | Encounter record, vitals + BMI, diagnoses + ICD-10, histories, corrections UI, attachments, pgcrypto helpers, patient isolation test | BE, FE, QA | Critical | Not Started |
| P5-01..05 | SCOPE-012, RX-001..008 | Prescriptions, medicine search, PDF with letterhead and signature, verification, ready-for-pickup | BE, FE | High | Not Started |
| P6-01..06 | SCOPE-013, LAB-001..007 | Test catalogue and ranges, orders, sample collection, results, senior approval, amended orders, report PDF | BE, FE, QA | High | Not Started |
| P7-01..06 | SCOPE-014, PHARM-001..006 | Medicines and batches, FIFO dispensing, quarantine, low-stock alerts, nightly expiry job, expired-dispense test | BE, FE, QA | High | Not Started |
| P8-01..07 | SCOPE-015, BILL-001..008 | Invoices and items, totals integrity, Stripe/Razorpay/cash, verified webhooks, receipts, TPA claims, reconciliation | BE, FE, QA | Critical | Not Started |
| P9-01..05 | SCOPE-016, NOTIF-001..010, TECH-024 | Event fan-out, per-channel queues, Socket.IO gateway, inbox UI, all eight triggers | BE, FE | High | Not Started |
| P10-01..04 | SCOPE-017, FE-010 | Patient portal: records, reports, invoices and payments, booking | FE, QA | High | Not Started |
| P11-01..05 | SCOPE-018/019, DASH-001..013 | Analytics endpoints, role dashboards (Recharts), global search | BE, FE | Medium | Not Started |
| P12-01..04 | SEC-001..015 | Security review against [SECURITY.md](SECURITY.md); upload scanning; dependency audit; audit viewer | LEAD, QA | High | Not Started |
| P13-01..03 | TEST-001..004, DEL-009 | Coverage to targets, E2E journeys, coverage report | QA | High | Not Started |
| P14-01..08 | SCOPE-021..023, DEP-001..006, DEL-001..011 | Production Compose, Dockerfile, Nginx TLS, AWS/Vercel, Sentry, seed data, README, report, video | LEAD | High | Not Started |
