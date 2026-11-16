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
| 1D | Auth frontend | 6 | 1 | **Review**: all screens built, 25 web tests pass (VM); Playwright `e2e/tests/auth.spec.ts` to run on macOS against the live stack |
| 2 | Hospital management | 6 | 0 | **Review**: API (6 modules, 35 routes) + 7 admin screens built; 617 API + 29 web tests pass (VM); `test/org.int-spec.ts` to run on macOS |
| 3–14 | Remaining modules, hardening, deployment | 69 | 0 | Not Started |

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
| P1A-04 | DB-020 | Create initial migration on macOS, append constraints, review SQL ([migration-review.md](migration-review.md)) | DB | owner "approve schema" | Critical | Done: `20261116085814_init` applied (Mac), drift empty, integration suites pass; migration 2 (DEC-032) pending apply | T-MIG-001 | DEC-019, DEC-025 |
| P1A-05 | DB-001..019 | Database constraint tests against real PostgreSQL | QA | P1A-04 | Critical | Done: T-MIG-001..006 pass (Mac 14:53); T-MIG-008 after migration 2 | T-MIG-002..006 | |
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
| B-1 | Migration 2 (DEC-032, approved) | Owner runs the 5 commands in [migration-review.md](migration-review.md) §10 | P1A-04/05, Done for 1B/1C (T-AUTH-INT-001, T-TEN-INT-001, T-MIG-*), Phase 2 |
| B-2 | ~~Design tokens~~ | Approved 15:19 (DEC-033) | — |
| B-3 | CI on GitHub | Owner approval to push | P0-14, P1C-07 |
| B-4 | Browser checks | Owner opens the status page and Swagger UI | P0-15, P0-16 |
| B-5 | Proposed decisions | Owner acknowledgement of DEC-014/015/020/023/025..030 | Records only; not blocking code |
| B-6 | Part 8 of the documentation instruction was cut off | Owner resends if it adds rules | — |

## Phase 1D — Authentication frontend

| Task ID | Req. | Task | Owner | Deps | Priority | Status | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1D-01 | Part 11 | Design tokens approved ([DESIGN.md](DESIGN.md)) | LEAD | owner | Critical | Done (DEC-033) | — |
| P1D-02 | Part 11 | Tokens in Tailwind/Shadcn, base components | FE | P1D-01 | Critical | Done | T-FE-* |
| P1D-03 | FE-002, AUTH-001/006 | `(auth)`: login, register, verify email/phone | FE | P1D-02, P1B | Critical | Done | T-FE-*, T-E2E-001 |
| P1D-04 | AUTH-004/005 | Forgot and reset password screens | FE | P1D-02, P1B-07 | High | Done | T-FE-* |
| P1D-05 | AUTH-003, TECH-018 | Auth store, silent refresh, role redirect, logout | FE | P1D-03 | Critical | Done | T-FE-* |
| P1D-06 | DEC-009 | Custom 404, Privacy, Terms (legal review flagged) | FE | P1D-02 | Medium | Done | T-FE-* |

## Phase 3 — Appointments

| Task ID | Req. | Task | Status | Tests |
| --- | --- | --- | --- | --- |
| P3-01 | SCOPE-007 | Weekly windows per doctor and department (hospital-local times, overlap 409, valid-from/to, pause) | Done | T-APPT-HTTP, T-RBAC-001c |
| P3-02 | SCOPE-008 | Date exceptions: leave, blocked time, extra hours | Done | T-APPT-HTTP |
| P3-03 | APPT-001, CACHE-002 | Slot generation in the hospital time zone, Redis cache 60 s, invalidated on every change | Done | T-APPT-HTTP, T-FE-018 |
| P3-04 | APPT-002, APPT-006, TEST-012 | Booking under a doctor row lock + exclusion constraints, 409 SLOT_UNAVAILABLE / PATIENT_DOUBLE_BOOKED | Done | T-APPT-001 (memory), T-APPT-INT-001 (Mac, pending) |
| P3-05 | APPT-003 | Status lifecycle with role rules, cancellation reason, no-show after start, reschedule | Done | T-APPT-HTTP, T-FE-019 |
| P3-06 | APPT-004 | Emergency bookings by reception outside slots (no doctor-overlap constraint) | Done | T-APPT-HTTP |
| P3-07 | APPT-005 | Reminders 24 h and 1 h before (BullMQ delayed jobs; email, SMS to verified phones) | Done | T-APPT-REM |
| P3-08 | FE | Screens: staff day agenda with actions, reception booking, availability management, patient portal booking and list, `GET /doctors/me` | Done | T-FE-018..021, T-E2E-003 (redirects only) |

Carried forward (not phase gates): signed-in booking E2E journey once seed data exists (P14, T-E2E-001..004 journeys); existing bookings are not cancelled automatically when leave is added (shown in the UI; revisit if the owner wants automatic handling).

## Phase 4 — Electronic medical records

| Task ID | Req. | Task | Status | Tests |
| --- | --- | --- | --- | --- |
| P4-01 | EMR-001, API-018 | Start consultation creates the record (appointment CONFIRMED → IN_PROGRESS in one transaction); completing closes it | Done | T-EMR-HTTP, T-APPT-HTTP |
| P4-02 | EMR-002, DEC-016 | Append-only notes and addenda; corrections as new rows with reason; closed records locked | Done | T-EMR-HTTP, T-EMR-INT-001 |
| P4-03 | EMR-003 | Vitals (doctor or nurse) with range checks and BMI calculated on read | Done | T-EMR-HTTP, T-FE-022 |
| P4-04 | EMR-004..006 | Chief complaint, symptoms, treatment plan; differential/confirmed diagnoses with ICD-10 search and a loader (`icd10:load`) | Done | T-EMR-HTTP, T-ICD-001 |
| P4-05 | EMR-007..009, EMR-011 | Patient history: allergies and reactions, medications, vaccinations, family history; resolved / entered in error | Done | T-EMR-HTTP |
| P4-06 | EMR-010, SEC-013 | Attachments ≤ 20 MB (PDF, PNG, JPEG, WebP by content), access-checked download | Done | T-EMR-HTTP |
| P4-07 | SEC-014, EMR-012, DEC-024 | pgcrypto column encryption (two parameterised helpers), `EMR_ENCRYPTION_KEY` | Done | T-EMR-INT-001 |
| P4-08 | API-019, TEST-011, FE | Access: doctors, nurses, own patient; read audit; screens: encounter start, record, chart, portal health record | Done | T-RBAC-001d, T-FE-022..025, T-E2E-004 |

Phase 4 verified 2026-11-16 22:10: integration 15/15 and Playwright 30/30 on macOS, unit and web tests, lint, typecheck and build in the VM, ICD-10 list loaded (78 codes). Carried forward: signed-in encounter E2E needs seed data (P14).

## Phases 5–7 plan

Approved by the owner 2026-11-16 22:10 with decisions D1–D10 (DEC-040): [implementation plan](https://claude.ai/artifact/2MDDoYb1Ps8Cw1QSZvqf8Y). Order: shared foundations (S-*), then Phase 5, Phase 6, Phase 7. Section 12 Recommended and Optional extras are not approved.

## Shared foundations (Phases 5–7) and Phase 5 — Prescriptions

| Task ID | Req. | Task | Status | Tests |
| --- | --- | --- | --- | --- |
| S-B1/S-C1 | RX-003, API-024, CACHE-002 | Medicine catalogue (`modules/medicines`): search with available stock cached 60 s, create, edit, deactivate; costs not exposed | Done | T-RX-HTTP-001, T-RBAC-001e |
| S-E1 | RX-008, DEC-040 D1 | PDFKit service: letterhead, facts, paged tables, page numbers (`infra/pdf/pdf.service.ts`) | Done | T-PDF-001 |
| S-F1 | RX-002 | `pdf` BullMQ queue, renderer registry, idempotent job ids, retry | Done | T-RX-HTTP, T-RX-INT-001 |
| S-F2 | DEC-040 D5 | In-process domain events (`common/events`) | Done | T-RX-HTTP |
| S-D1 | FE | Shared web: exported `Picker`, `StockBadge`, `PdfButton`, `saveBlob` | Done | T-FE-026..029 |
| 5-A1 | DEC-040 D3/D4 | Migration M-05 `20261116170000_prescriptions_cancel_and_allergy_ack` (approved 22:10; to apply on macOS) | Done | T-RX-INT-001 |
| 5-B1/5-C1 | RX-001..006, API-020/021 | Issue (treating doctor, open record, signature required, item rules), allergy check with acknowledged reason, cancel before dispensing, list and read with patient ownership, read audit | Done | T-RX-HTTP-002..005 |
| 5-E1/5-F1 | RX-002, RX-007, RX-008 | Prescription PDF with letterhead, patient and doctor block, items, notes, allergy acknowledgement, signature image; queued after commit | Done | T-RX-HTTP-002, T-RX-INT-001 |
| 5-D1 | FE | Record view Prescriptions panel and form (catalogue search, quantity suggestion, allergy dialog), cards with PDF and cancel, chart section, portal Prescriptions, Medicines catalogue page | Done | T-FE-026..029, T-E2E-005 |

Phase 5 verified 2026-11-16 22:42 (owner report): pnpm install, M-05 applied, drift clean, integration and Playwright passed on macOS.

## Phase 6 — Laboratory

| Task ID | Req. | Task | Status | Tests |
| --- | --- | --- | --- | --- |
| 6-A1 | DEC-040 D7/D8 | Migration M-06 `20261116180000_lab_orders_cancel_and_result_reference` (approved; to apply on macOS) | Done | T-LAB-INT-001 |
| 6-B1 | LAB-006, DEC-040 D2 | Test catalogue with gender and age reference ranges (most specific wins, limit is normal); radiology has no ranges | Done | T-LAB-HTTP-001, T-LAB-HTTP-003 |
| 6-B2 | LAB-001, LAB-002 | Orders by the treating doctor on an open record; cancel before sample with a reason; sample collected by reception or lab; processing | Done | T-LAB-HTTP-005 |
| 6-B3 | LAB-003, LAB-006 | Result entry with flag and range/unit snapshot; PDF report upload (content-checked, 20 MB); submit needs every result or a report | Done | T-LAB-HTTP-002, T-LAB-HTTP-004 |
| 6-B4 | LAB-004, LAB-005, DEC-040 D7 | Senior approval by someone who entered none of the results; rejection back to the technician; values hidden until approval; approved lock (trigger); `lab.report.approved` event | Done | T-LAB-HTTP-002, T-LAB-HTTP-004, T-LAB-INT-001 |
| 6-B5 | LAB-007 | Amended report as a new linked order; report PDF generated on approval | Done | T-LAB-HTTP-004 |
| 6-D1 | FE | Record view Lab panel and order form; cards with flags, PDFs and cancel; chart section; doctor home "Latest approved lab results"; reception samples; lab worklist; order work page (live flag preview, upload, approve, send back, amend); Lab tests catalogue; portal Lab reports | Done | T-FE-030..035, T-E2E-006 |

| 6-F1 | RX-002, APPT-005, DEC-041 | Defect found in the 23:07 log: BullMQ refused the PDF job id `prescription:<id>`, so no prescription PDF was generated. Ids now use "-"; reminders moved too, with old ids still cleaned up; regression tests use BullMQ's own validation; integration test goes through the real worker | Done (VM); Mac re-run pending | T-PDF-002, T-APPT-REM, T-RX-INT-001 |

Phase 6 Mac run 2026-11-16 23:07 (owner report): M-06 applied, generate ok, drift empty, integration 9 suites 17/17, Playwright 44/44. After the 6-F1 fix (VM): API 1160/1160, web 48/48, lint, format, typecheck and build clean. **Sign-off waits for one Mac re-run of `pnpm test:int`**, the only check that exercises the real queue and worker.

## Phases 2–14 (from the roadmap; detailed breakdown added when each phase starts)

| Task ID | Req. | Task | Owner | Priority | Status |
| --- | --- | --- | --- | --- | --- |
| P2-01..06 | SCOPE-005/006, ROLE-001/002, API-013/014/015 | Hospital onboarding and verification; departments; staff; doctors (signature upload); patients (MRN); rooms and beds | BE, FE | Critical | Done (2026-11-16: VM unit, Mac integration 14/14, E2E 20/20) |
| P3-01..08 | SCOPE-007..009, APPT-001..006, CACHE-002 | Weekly availability, exceptions, slots (60 s cache), booking with locks, status lifecycle, emergency, reminders 24 h/1 h, booking UI | BE, FE, QA | Critical | Done (see Phase 3 below) |
| P4-01..08 | SCOPE-010/011, EMR-001..012, SEC-013/014 | Encounter record, vitals + BMI, diagnoses + ICD-10, histories, corrections UI, attachments, pgcrypto helpers, patient isolation test | BE, FE, QA | Critical | Done (2026-11-16) |
| P5-01..05 | SCOPE-012, RX-001..008 | Prescriptions, medicine search, PDF with letterhead and signature, verification, ready-for-pickup | BE, FE | High | Done (2026-11-16; verification and ready-for-pickup land with Phase 7 per D9) |
| P6-01..06 | SCOPE-013, LAB-001..007 | Test catalogue and ranges, orders, sample collection, results, senior approval, amended orders, report PDF | BE, FE, QA | High | Review (Mac checks passed 23:07; queue fix awaits one `pnpm test:int` re-run) |
| P7-01..06 | SCOPE-014, PHARM-001..006 | Medicines and batches, FIFO dispensing, quarantine, low-stock alerts, nightly expiry job, expired-dispense test | BE, FE, QA | High | Not Started |
| P8-01..07 | SCOPE-015, BILL-001..008 | Invoices and items, totals integrity, Stripe/Razorpay/cash, verified webhooks, receipts, TPA claims, reconciliation | BE, FE, QA | Critical | Not Started |
| P9-01..05 | SCOPE-016, NOTIF-001..010, TECH-024 | Event fan-out, per-channel queues, Socket.IO gateway, inbox UI, all eight triggers | BE, FE | High | Not Started |
| P10-01..04 | SCOPE-017, FE-010 | Patient portal: records, reports, invoices and payments, booking | FE, QA | High | Not Started |
| P11-01..05 | SCOPE-018/019, DASH-001..013 | Analytics endpoints, role dashboards (Recharts), global search | BE, FE | Medium | Not Started |
| P12-01..04 | SEC-001..015 | Security review against [SECURITY.md](SECURITY.md); upload scanning; dependency audit; audit viewer | LEAD, QA | High | Not Started |
| P13-01..03 | TEST-001..004, DEL-009 | Coverage to targets, E2E journeys, coverage report | QA | High | Not Started |
| P14-01..08 | SCOPE-021..023, DEP-001..006, DEL-001..011 | Production Compose, Dockerfile, Nginx TLS, AWS/Vercel, Sentry, seed data, README, report, video | LEAD | High | Not Started |
