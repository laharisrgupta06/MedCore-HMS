# MedCore HMS — Decision Register

Every significant product, architecture, database, design and process decision. Status values:
**Proposed** (recommended or implemented, not yet explicitly approved), **Approved**, **Rejected**,
**Superseded** (kept for history). Approvals quote the project owner where possible. All dates are
2026-11-16 (IST) unless noted. Never delete an entry: mark it superseded and add a new one.

---

### DEC-001: Approved roadmap and technology stack as the baseline
- Status: **Approved** ("I'm approving this roadmap as our development baseline")
- Context: The PRD (section 04) fixes the stack. A 12-section roadmap was produced from it.
- Final decision: Keep the full PRD stack; the roadmap ([implementation-roadmap.md](implementation-roadmap.md)) is the implementation sequence.
- Impact: All phases. Related: TECH-*, SCOPE-*.

### DEC-002: No AI or LLM functionality in the application
- Status: **Approved** (owner instruction, repeated in every brief)
- Final decision: No AI/LLM APIs, SDKs or AI-dependent features. Deterministic logic, SQL and rules only.
- Related: OUT-003. Enforced in [RULES.md](RULES.md).

### DEC-003: Local or mock providers during development
- Status: **Approved** ("must remain fully runnable locally without requiring paid API subscriptions")
- Final decision: Email, SMS, payments and storage behind adapter interfaces with local implementations; real providers (Resend, Twilio, Stripe, Razorpay, S3) enabled by environment configuration.
- Related: SCOPE-015, SCOPE-016, NOTIF-*, BILL-004.

### DEC-004: Same-origin API proxy through Next.js
- Status: **Approved** ("Use the Next.js same-origin API proxy approach")
- Problem: A SameSite=Strict refresh cookie fails across Vercel and EC2 domains.
- Final decision: The browser calls only the Next.js origin; `/api/*` is rewritten to the NestJS API.
- Files: `apps/web/next.config.ts`, `apps/web/lib/api-client.ts`. Related: AUTH-002, SEC-010.

### DEC-005: Node.js 24 LTS and pnpm 11 instead of Node 20 and pnpm 9
- Status: **Approved** ("I've decided on Option A: Node.js 24 LTS + pnpm 11")
- Context: Node.js 20 reached end of life on 2026-04-30; pnpm 9 is two majors behind.
- Options: A Node 24 + pnpm 11; B Node 22 + pnpm 11; C PRD versions without security patches.
- Impact: `.nvmrc` = 24, `packageManager` = pnpm@11.28.12. Related: TECH-040.

### DEC-006: Roadmap defaults for PRD ambiguities
- Status: **Approved** (owner approval of roadmap defaults A1–A4 and one hospital per user)
- Final decision: `isSeniorLabTechnician` flag instead of a tenth role; radiology as a lab-test category (no DICOM); basic nurse administration notes; minimal subscription fields on Hospital; each user belongs to exactly one hospital (global unique email).
- Related: LAB-004, LAB-007, ROLE-004, ROLE-001.

### DEC-007: Row-level multi-tenancy in a shared schema
- Status: **Approved** (part of the roadmap baseline, DEC-001)
- Options: database per tenant; schema per tenant; shared schema with `hospitalId`.
- Final decision: Shared schema with `hospitalId`, enforced in the database (DEC-018) and query layer.
- Reason: Many small-to-large hospitals on one deployment; a solo developer cannot run per-tenant migrations.
- Related: TEN-001..005.

### DEC-008: Database Engineer owns schema and migrations
- Status: **Approved** ("The Database Engineer owns the Prisma schema, database design and migrations")
- Impact: Supersedes the roadmap statement that the Team Lead owns the schema. Applies to the agent team (DEC-021).

### DEC-009: Frontend completeness scope and custom domain
- Status: **Approved**
- Final decision: Privacy Policy, Terms and Conditions (flagged for legal review), custom 404 and the Part 11 SEO items are in scope. A custom domain is optional; nothing may depend on buying one during development.
- Related: [frontend-design-system.md](frontend-design-system.md) §11.10, §11.15.

### DEC-010: Patient self-registration uses a hospital code
- Status: **Approved** (decision 1a)
- Problem: Each user belongs to one hospital; the PRD does not say how a patient chooses it.
- Options: (a) hospital code; (b) public list of verified hospitals (an endpoint not in the PRD).
- Impact: `hospitals.code` unique; `POST /auth/register` takes the code. Related: AUTH-001, DB-005.

### DEC-011: Local OTP delivery without logging OTPs
- Status: **Approved** ("Email OTPs must go through Mailpit. SMS OTPs must use a separate local development-only inbox/adapter. Never log OTPs or expose them in production.")
- Final decision: Email to Mailpit over SMTP; SMS to a separate development-only inbox adapter; neither selectable in production (startup validation); OTPs never logged.
- Related: AUTH-006, AUTH-007, AUTH-012. Implementation: Phase 1B.

### DEC-012: Password policy
- Status: **Approved** (decision 3)
- Final decision: 10–128 characters, at least one letter and one number, not equal to the email address.
- Related: AUTH-001, AUTH-005.

### DEC-013: First Super Admin created by a CLI command
- Status: **Approved** (decision 4)
- Final decision: `pnpm --filter @medcore/api create-super-admin` prompts for email and password; no public endpoint.
- Related: ROLE-001.

### DEC-014: Library major versions
- Status: **Proposed** (implemented in Phase 0 and reported; not explicitly approved)
- Decision as implemented: NestJS 11 (not ESM-only 12), TypeScript 5.9 (ts-jest supports <7), Prisma 6.19 (8 is a release candidate), ESLint 9, Next.js 15.5 (PRD-mandated), Tailwind 4, BullMQ 6, Vitest 5.
- Reason: Stable, verifiable tooling; PRD rule "do not upgrade major versions simply because newer versions exist".
- Files: `package.json` files, `pnpm-lock.yaml`. Record: [phase-0-checklist.md](phase-0-checklist.md).

### DEC-015: Phase 0 deferrals
- Status: **Proposed** (implemented and reported; not explicitly approved)
- Decision as implemented: MinIO local storage deferred to the phase that needs uploads; API Dockerfile and Nginx config moved to Phase 14 (cannot be built or tested in the build VM); route groups created with their first real pages (no placeholder routes); unused web libraries installed when used.
- Related: TECH-027, DEP-001, FE-002.

### DEC-016: Clinical corrections preserve originals
- Status: **Approved** ("Approve the clinical correction design"; conditions: originals preserved permanently; every correction records who, when and why)
- Final decision: Corrections are new rows (`supersedesId`/`amendsEntryId` + required reason); patient-level history changes only status with who/when/why; closed records and approved lab orders are locked; corrections to approved lab results are amended orders.
- Files: `apps/api/prisma/schema.prisma`, `apps/api/prisma/sql/constraints.sql`, [database-schema.md](database-schema.md). Related: EMR-002, DB-014, LAB-004.

### DEC-017: Seven PRD gap fixes in the schema
- Status: **Approved** ("all seven proposed PRD gap fixes")
- Final decision: `hospitalId` on addresses and notification deliveries; hospital tax rate and invoice prefix; prescription verification fields; READY_FOR_PICKUP status; payment reconciliation fields; correction model (DEC-016); role/profile consistency trigger for all nine roles.
- Related: TEN-002, ROLE-002, ROLE-007, NOTIF-005, ROLE-008, EMR-011.

### DEC-018: Composite tenant foreign keys (option A)
- Status: **Approved** ("option A (composite foreign keys)"; condition: cover all relevant tenant relationships)
- Options: A composite `(id, hospitalId)` foreign keys; B PostgreSQL RLS; C application-only.
- Final decision: 85 composite relations in Prisma plus 3 SQL composite foreign keys; exceptions documented (ICD-10 codes, audit-log actor). Guarded by `schema-tenancy.spec.ts`.
- Related: TEN-002, TEN-003.

### DEC-019: Complete core schema (44 models, 36 enums)
- Status: **Proposed — awaiting final "approve schema"** (revisions 1 and 2 reviewed; DEC-016..018 approved)
- Final decision pending: approval to create and apply the initial migration on macOS.
- Files: `apps/api/prisma/schema.prisma` (commit `e487298`). Related: SCOPE-002, DB-001..020.

### DEC-020: Appointment concurrency control
- Status: **Implemented** (Phase 3; constraints applied with the approved migration)
- Decision: PostgreSQL exclusion constraints (doctor overlap except EMERGENCY; patient overlap) as the hard guarantee, plus a transaction with row locking in the booking service returning `409 SLOT_UNAVAILABLE`.
- Related: APPT-002, APPT-004, APPT-006, TEST-012.

### DEC-021: Where the agent team runs
- Status: **Superseded by DEC-022**
- History: 11:54 approved option (a), run the team in local Claude Code. 12:25: "Stop all Agent Teams and OpenRouter troubleshooting… Use the current Claude Code session. Do not spawn teammates."

### DEC-022: Working mode until Agent Teams are verified
- Status: **Approved, final** (13:46: "We are abandoning Agent Teams and sub-agents… work as a SINGLE Claude Code session.")
- Current state: work proceeds solo in the current session. The latest brief asks for a five-role team once enabled and approved. Blockers: Agent Teams run only in interactive local Claude Code; local Claude Code returned `401 User not found` through OpenRouter (unresolved); this chat session cannot spawn agent teams.
- Pending: owner decision on resolving local authentication and approving the team plan in [MEMORY.md](MEMORY.md).

### DEC-023: Redis-backed rate limiting and shared-types build
- Status: **Proposed** (implemented in Phase 0)
- Decision: Custom `ThrottlerStorage` with an atomic Redis Lua script; `@medcore/types` built by a `prepare` script and before `test:int`.
- Related: CACHE-003, SEC-005, API-005.

### DEC-024: pgcrypto via two parameterised raw-SQL helpers
- Status: **Approved** (roadmap baseline, contradiction C2)
- Context: PRD says "never use raw()" and also requires pgcrypto, which Prisma cannot call.
- Decision: Only two reviewed, parameterised helpers (Phase 4); no string-built SQL.
- Related: SEC-008, SEC-014.

### DEC-025: Migrations created on macOS
- Status: **Proposed** (operational constraint)
- Context: Prisma's migration engine download is blocked in the build VM.
- Decision: The schema is written and validated in the VM; the owner runs `prisma:migrate:create`, the constraints SQL is appended and reviewed, then `prisma:migrate` applies it.
- Related: DB-020.

### DEC-026: bcryptjs for bcrypt hashing
- Status: **Proposed** (Phase 1B implementation)
- Decision: `bcryptjs` (pure JavaScript bcrypt, cost 12) instead of the native `bcrypt` package: same algorithm and hash format (`$2b$12$`), no native build step on macOS, the build VM or CI.
- Related: AUTH-011, SEC-001.

### DEC-027: @nestjs/jwt 11
- Status: **Proposed**
- Decision: `@nestjs/jwt` 11 (CommonJS). Version 12 is ESM-only and cannot be loaded by the CommonJS API under Jest.
- Related: DEC-014.

### DEC-028: Auth endpoint details not spelled out in the PRD
- Status: **Proposed** (Phase 1B implementation)
- Additions: `GET /auth/csrf` (issues the CSRF cookie); `POST /auth/verify-email/resend`; `POST /auth/verify-phone/send` (signed-in user); development-only `GET/DELETE /api/dev/sms-inbox` (not routed in production, DEC-011).
- Behaviour: login requires a verified email (403 EMAIL_NOT_VERIFIED); suspended hospitals cannot sign in; resend and forgot-password give the same answer whether or not the account exists; the CSRF token rotates at login and refresh and is also returned in the response body; reset tokens are single use, 30 minutes, and revoke every session; refresh-token reuse revokes every session of the user; patient MRN format `MRN-{year}-{6-digit sequence}` per hospital.
- Related: AUTH-001..010, SEC-010.

### DEC-029: Tenant scoping mechanism and users endpoint rules
- Status: **Proposed** (Phase 1C implementation of the approved row-per-tenant design)
- Decision: AsyncLocalStorage request context + `TenantGuard` + a Prisma query extension (`TenantPrismaService`); other tenants' records answer 404; Super Admin uses the unscoped client and those requests are audited. Users endpoints: list for administrators (Super Admin may filter by hospital); get/patch for self or administrator; `isActive` and delete for administrators only, never on oneself; delete is a soft delete that signs the user out everywhere; email and role are not editable here (email change needs a verification flow; roles change with staff management in Phase 2). The audit interceptor logs every successful write with the redacted body.
- Related: TEN-003/004, API-012, SEC-012, ROLE-011.

### DEC-030: Audit entries store metadata, never values
- Status: **Proposed** (owner request 14:17: "Prefer safe, redacted audit metadata")
- Decision: generic write audits record method, route, entity, actor, hospital, IP, user agent and the **names** of submitted fields. Values are stored only for fields a route lists as safe in `@Audit(action, entity, safeFields)` and only as short scalars, still redacted. Every entry, from any source, passes `safeChanges()`: sensitive keys redacted, any `body` key dropped, strings cut at 200 characters, nesting limited. Auth audit entries carry only the opaque session id (not a credential: a refresh requires the signed token). Before/after values for clinical data are not stored in the audit log; the clinical tables keep originals and corrections themselves (DEC-016).
- Related: SEC-012, AUTH-012, DB-013.

### DEC-031: Hand-written foreign keys and unique constraints are also declared in schema.prisma
- Status: **Proposed** (owner request 14:33 after `prisma:drift` reported four DROPs)
- Finding: the initial migration (`20261116085814_init`, applied by the owner on macOS) contains, from `constraints.sql`, three composite same-tenant foreign keys (`hospitals_address_same_tenant_fkey`, `notifications_recipient_same_tenant_fkey`, `notification_deliveries_same_tenant_fkey`) and one unique constraint (`notifications_id_hospital_key`). Prisma Migrate owns all foreign keys and unique constraints: anything in the database that `schema.prisma` does not declare is drift and would be dropped by the next generated migration. CHECK constraints, exclusion constraints, triggers, functions and expression/partial indexes are outside Prisma's model and are not reported, which matches the drift output.
- Decision: keep all four (they are intentional tenant-isolation guarantees, DEC-018) and declare them in `schema.prisma` with identical names, columns and actions: `@@unique([id, hospitalId], map: "notifications_id_hospital_key")` and three additional relation fields (`addressSameTenant`, `recipientSameTenant`, `notificationSameTenant`) with `onDelete` as in SQL and `onUpdate: NoAction`. The existing single-column relations stay, so platform-level rows (hospitalId NULL) keep their plain foreign keys. The database is unchanged; no new migration is needed if the drift check comes back empty.
- Guard: `src/infra/prisma/sql-drift.spec.ts` fails if any `ADD CONSTRAINT … FOREIGN KEY|UNIQUE` in hand-written SQL lacks a matching `map:` in the schema.
- Related: DEC-018, DEC-025, migration-review.md M-02.

### DEC-032: Hospital ids after DEC-031
- Status: **Approved** (owner, 14:53: "I approve DEC-032"). Implemented as migration `20261116092500_hospital_id_db_default` (created, not yet applied)
- Root cause of the 14:41 integration failures: DEC-031 made `hospitals.id` part of the declared foreign key `hospitals_address_same_tenant_fkey` (`[addressId, id]`). Prisma does not apply `@default(uuid())` to a field that is also a relation scalar: `HospitalCreateInput` loses `id` and an insert without an explicit id sends NULL (`Null constraint violation on the fields: (id)`). The database column has no default (Prisma generates ids client-side), so every `hospital.create()` without an id fails. All three failing suites create hospitals first.
- Interim (no database change): every hospital insert passes `id: randomUUID()` (the three integration suites). No application code creates hospitals yet; Phase 2 onboarding must do the same until the permanent fix.
- Permanent fix (proposed): one migration `ALTER TABLE "hospitals" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();` with `@default(dbgenerated("gen_random_uuid()"))` in `schema.prisma`. The database then generates ids whatever Prisma omits. Checked on a disposable PostgreSQL 16 copy of the applied migration: insert without id succeeds. Nothing is created in the repository until approved.
- Related: DEC-031, M-02.

### DEC-033: Design tokens approved
- Status: **Approved** (owner, 2026-11-16 15:19: "Approve tokens")
- Decision: the tokens and component standards in [DESIGN.md](DESIGN.md) (sage `#52714D` primary, tomato `#C8432B` accent used sparingly, off-white `#FAF8F3` background, text `#1E2420`, error `#B42318`; IBM Plex Sans with Source Serif 4) are the design system. Unblocks Phase 1D and every styled screen.
- Related: frontend-design-system.md §11.18, P1D-01.

### DEC-034: Execution mode
- Status: **Approved** (owner, 15:19: "Real team on my Mac")
- Decision: development continues as a real Claude Code Agent Team launched from Claude Code in the owner's Mac terminal, once its sign-in works. Teammates use the lead's model (`model: inherit`) at `effort: medium` from `.claude/agents/*.md`; the model must be confirmed as Opus 5.5 with `/model` before launch. The cloud chat session cannot create a team (no team tools). Supersedes DEC-022.

### DEC-035: Single-session development (final)
- Status: **Approved** (owner, 15:28: "We are permanently proceeding with ONE SINGLE CLAUDE CODE SESSION.") Supersedes DEC-034.

### DEC-036: Frontend session handling
- Status: **Approved** (owner, 2026-11-16 17:24, as built)
- Decision: the access token stays in memory (Zustand), never in browser storage; the page restores a session with `POST /auth/refresh` from the httpOnly cookie; refreshes are single-flight and serialised across tabs with the Web Locks API so two tabs never replay the same rotated token; logout is broadcast to other tabs. Route protection is client-side for rendering only. Fonts are self-hosted through `@fontsource` packages (no runtime third-party requests). The web app sends `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a restrictive permissions policy.

### DEC-037: Phase 2 account and file rules
- Status: **Approved** (owner, 2026-11-16 17:24, as built; set-password links stay at 72 h)
- Decision: accounts created by staff (hospital admin, staff, doctors, reception-registered patients) start with an unusable password placeholder and receive a single-use 72-hour "set your password" link (the existing reset flow); staff never choose or see passwords; a failed welcome email does not fail the request and can be resent (`POST /staff/:userId/invite`, or forgot password). Hospital codes are immutable after creation. Suspending a hospital revokes every session of its users. Roles never change in place (DEC-017): a different role means a new account. Doctor signatures: PNG or JPEG detected from the file's magic bytes (declared type must match), at most 512 KB, stored through `StorageService` (local disk in development, path-safe generated keys) with a `FileAttachment` row (sha256, size). Nurses may change bed status only. Departments and rooms that are referenced cannot be deleted (409 IN_USE).


### DEC-038: Phase 3 booking rules
- Status: **Approved** (owner, 2026-11-16 17:24) with one change: patients cannot cancel online within 2 hours of the start (`400 CANCELLATION_TOO_LATE`); reception, doctors and admins still can. Leave keeps existing bookings (as built). `GET /doctors/me` approved.
- Decision: schedules and exceptions are stored as hospital-local wall-clock times and converted with the hospital's IANA time zone, so DST and travelling viewers always see hospital time. Slots are generated per local date, cached in Redis for 60 s (`slots:{doctorId}:{date}`) and invalidated on every booking, status change and schedule change. Booking runs in a transaction that locks the doctor row, re-checks overlaps, and relies on the exclusion constraints as the final guard; conflicts return `409 SLOT_UNAVAILABLE` or `PATIENT_DOUBLE_BOOKED`. Patients and reception book; doctors do not book (they manage availability). Emergency bookings are reception-only, start CONFIRMED, take the hospital default slot length and may overlap the doctor's other appointments. New regular bookings start PENDING; reception, doctors or admins confirm. Only the doctor starts and completes a consultation. Patients may only cancel, at least 2 hours before the start time (`PATIENT_CANCEL_NOTICE_MS`), with a reason; NO_SHOW only after the start time. Rescheduling (reception or the patient) moves to a free slot and returns the appointment to PENDING. Reminders are BullMQ delayed jobs 24 h and 1 h before, re-checked at send time. Adding leave does not cancel existing bookings automatically. `GET /doctors/me` added so a doctor's screens can find their own profile (mirrors `GET /patients/me`).
- Related: SCOPE-007..009, APPT-001..006, CACHE-002, DEC-020.

### DEC-039: Phase 4 medical record rules
- Status: **Approved** (owner, 2026-11-16 22:00, exactly as described); verified on macOS 22:10 (integration 15/15, Playwright 30/30)
- Decision: (1) The consultation starts with `POST /medical-records` (chief complaint required), which moves the appointment from CONFIRMED to IN_PROGRESS and creates the record in one transaction; `PATCH /appointments/:id/status` no longer accepts IN_PROGRESS (`START_FROM_ENCOUNTER`), so every consultation has a record (EMR-001). Completing the appointment closes the record. (2) Only the treating doctor writes encounter content; nurses may add vitals and attachments; doctors and nurses maintain patient-level history. Readers: doctors and nurses of the hospital and the patient (own only); hospital admins and other roles have no clinical access (API-019). Every record, chart, history and file view is audited. (3) Nothing clinical is edited or deleted: notes become addenda after closing; corrections are new rows with a reason, at most one per row; history entries can be marked RESOLVED or ENTERED_IN_ERROR (final, with reason). (4) Notes, treatment plan and diagnosis text are encrypted with pgcrypto (AES-256) using `EMR_ENCRYPTION_KEY`; chief complaint and symptoms stay plain text as in the approved schema. (5) Attachments: PDF, PNG, JPEG, WebP detected from content, name must match, max 20 MB. (6) ICD-10 codes are optional and come from a reference table loaded with `pnpm --filter @medcore/api icd10:load` (bundled starter subset of public-domain ICD-10-CM; the full file loads the same way). (7) Unit tests no longer load the developer's `.env` (throttler options moved out of AppModule).
- Owner action: `EMR_ENCRYPTION_KEY` is configured in the development `.env` (checked 21:01 without reading the value); back it up, because encrypted values cannot be read without it.
- Related: SCOPE-010/011, EMR-001..012, SEC-013/014, DEC-016, DEC-024.

### DEC-040: Phases 5–7 plan decisions (D1–D10)
- Status: **Approved** (owner, 2026-11-16 22:10), with the plan's scope and Essential items; Recommended and Optional extras in its section 12 are not approved.
- Decisions: D1 PDFKit for PDFs (replaces the roadmap's Puppeteer). D2 the shared medicine catalogue is built in Phase 5. D3 prescriptions are never edited after issue; cancellation needs a reason and is allowed only before any dispensing. D4 allergy conflicts need explicit acknowledgement and a recorded reason. D5 domain events now; email, SMS and in-app delivery in Phase 9. D6 Phase 8 creates invoice lines for lab tests and dispensed medicines. D7 a rejected lab report returns to the technician for correction. D8 reference range and unit are copied onto each lab result. D9 dispensing sets READY_FOR_PICKUP and hand-over sets DISPENSED. D10 no medicine category, unit or supplier management screens.
- Plan: https://claude.ai/artifact/2MDDoYb1Ps8Cw1QSZvqf8Y
- Migration M-05 (prescription cancel fields, allergy override reason, two CHECKs) approved by the owner 2026-11-16.
- Implementation notes (Phase 5): PDFs use PDFKit's standard Helvetica fonts (no font files shipped); allergy matching is by medicine and generic name, case-insensitive, on active uncorrected allergies, and is advisory; issuing requires the doctor's stored signature (RX-007); prescriptions are read by doctors, nurses, pharmacists and the patient (own); the PDF by doctors, pharmacists and the patient (own).
- Migration M-06 (lab order CANCELLED status with reason fields, rejection fields, result unit and reference snapshot, three CHECKs) approved by the owner 2026-11-16.
- Implementation notes (Phase 6): the most specific range wins (gender and age band each count) and a value equal to a limit is normal; radiology tests have no ranges and take text findings; a submitted order needs every result or an attached PDF report; the reviewer must be a senior technician (`StaffProfile.isSeniorLabTechnician`) who entered none of the current results; the report PDF is generated on request, not queued.
- Related: SCOPE-012..014, RX-*, LAB-*, PHARM-*, DEC-024, DEC-039.

### DEC-041: BullMQ job ids use "-" instead of ":" (defect fix)
- Status: **Proposed** (implementation-level fix, 2026-11-16 23:30, after the owner's Phase 6 Mac run)
- Problem: the Phase 6 integration log showed "Could not queue the PDF for prescription … Custom Id cannot contain :". BullMQ 6 refuses a custom job id with a ":" unless it has exactly three ":"-separated parts (kept only for old repeatable jobs). The PDF id `prescription:<uuid>` has two, so every `queue.add` threw. Issuing still succeeded (the error is caught and logged by design), but no prescription PDF was ever generated in the running app, and "Request again" failed the same way. Tests missed it: unit tests replace the queue with an inline fake, and the integration test called the renderer directly.
- Decision: PDF job ids are `{kind}-{id}` (`pdfJobId`). Appointment reminder ids (`reminder:{id}:{offset}`, accepted today only by the three-part exception that BullMQ marks for removal) move to `reminder-{id}-{offset}` (`reminderJobId`); cancelling also removes the old-form ids, so reminders queued before the change are still replaced. Leftover old jobs cannot send a wrong reminder: the sender skips cancelled or moved appointments.
- Tests: `src/testing/validating-queue.ts` runs BullMQ's own option validation without Redis; used by `infra/pdf/pdf-jobs.spec.ts` (fails on the old id) and `reminders.spec.ts`. `test/prescriptions.int-spec.ts` now waits for the real queue and worker to store the PDF instead of calling the renderer.
- Verified: owner's macOS `pnpm test:int` 23:15, 9/9 suites, 17/17 tests, prescription PDF stored through the real queue and worker.
- Owner action: prescriptions issued before this fix have no PDF; the prescribing doctor can press "Request again" on each.
- Related: RX-002, APPT-005, DEC-040 D1/D5.

### DEC-042: Phase 7 pharmacy rules and migrations M-07, M-08, M-09
- Status: business rules **Approved** (owner, 2026-11-16 23:17). Migrations M-07, M-08 and M-09: **awaiting owner approval** before they are applied on macOS (validated on PostgreSQL 16 in the build environment).
- Approved rules: (1) low stock means available stock strictly below the reorder level (PHARM-003); the Phase 5 stock badge follows the same rule (`isLowStock` in `@medcore/types`). (2) The expiry report runs at 02:00 in each hospital's own time zone. (3) Only VERIFIED hospitals are processed. (4) The nightly run quarantines expired batches automatically, recording a stock movement without changing the quantity.
- M-07 `medicines.lowStockSince` (nullable): set once per crossing with a conditional update, so one `stock.low` event per crossing even under concurrent dispensing; cleared on restock or deactivation. M-08 `expiry_reports`: one row per hospital and local day (unique key makes runs idempotent), items JSON must be an array, hospital FK RESTRICT. M-09 (found necessary while finalising M-08): the existing schema required a performer on every stock movement and forbade zero quantities, and the ledger and dispenses were not append-only although the plan relies on it. M-09 allows a missing performer only on QUARANTINE rows with a reason, fixes ledger signs (QUARANTINE quantity = units set aside, positive, excluded from the quantity balance), links DISPENSE rows to dispenses, requires reasons for adjustments and quarantines, and adds append-only triggers on `stock_movements` and `dispenses`.
- Tenant isolation: every pharmacy query names the hospital explicitly in addition to the tenant-scoped client; no raw SQL; Super Admin has no stock routes; the nightly job uses the base client and passes the processed hospital into every query and its transaction. No route takes an expiry-report id (the report is read through `GET /pharmacy/alerts` for the caller's hospital only).
- Implementation notes: FIFO = earliest expiry, then earliest receipt (`allocateFifo`, shared by server and dispense preview); a batch expiring today is expired; dispensing requires verification, locks the prescription row first, decrements each batch conditionally (`quantity >= n`, ACTIVE, unexpired) and answers 422 `MEDICINE_EXPIRED` when only expired stock remains (TEST-014) or 422 `INSUFFICIENT_STOCK`; the job scheduler `expiry-sweep` runs at minute 7 every hour and processes each hospital past 02:00 local without today's report, each in its own transaction; one hospital failing is logged (and sent to Sentry when configured) and retried next hour. The API has no single-medicine route (PRD API-024 lists search only), so the stock view opens from the inventory list. Suppliers are not exposed (D10).
- Related: SCOPE-014, PHARM-001..006, TEST-014, CACHE-002, NOTIF-008, DEC-040, DEC-041.

