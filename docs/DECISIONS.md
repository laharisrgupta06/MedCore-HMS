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
- Status: **Proposed** (part of the schema pending DEC-019)
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

