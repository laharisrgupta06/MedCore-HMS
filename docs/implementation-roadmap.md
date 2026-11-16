# MedCore HMS — Implementation Roadmap

> **Exported copy.** Source of truth: the Claude Doc "MedCore HMS — Implementation Roadmap" (https://claude.ai/artifact/88cGf3WmeEoEG9hKkh6srM), exported 2026-11-16 at revision 20. Two diagrams (system architecture, four-week roadmap) cannot be exported to Markdown and appear as placeholders; view them in the live doc. Approved amendments made after export (2026-11-16): the Database Engineer owns the Prisma schema and migrations; Privacy Policy, Terms and Conditions, custom 404 and Part 11 SEO items are in scope; a custom domain is optional during development; the Next.js same-origin API proxy is the chosen cookie approach.


Nov 16, 2026 · @Lahari

A planning-only, execution-ready roadmap for building MedCore HMS from an empty repository, derived from the 28-page PRD. No AI APIs, no code yet.

## 1. Project understanding and scope

MedCore HMS is a multi-tenant hospital SaaS: one deployment serves many hospitals (tenants), each with nine roles, covering registration through billing. The PRD is a 4-week solo brief, and its coordinator note says depth beats breadth, so the plan builds one vertical journey first (Auth → Appointments → EMR → Billing) and layers the rest on it.

**Core journey the whole plan protects:** Patient registers → books slot → receptionist confirms → doctor starts encounter (EMR) → prescribes / orders lab → lab approves → pharmacy dispenses → invoice → payment webhook → receipt.

### Scope classification

| Class | Items |
| --- | --- |
| **Mandatory (PRD in-scope)** | Monorepo + Docker Compose; Prisma schema + migrations; JWT + refresh rotation + email OTP + phone OTP; RBAC for 9 roles; hospital onboarding; departments + doctor profiles; availability calendar + slots; booking with conflict detection; status lifecycle; EMR (vitals, BMI, diagnosis/ICD-10, plan, allergies, vaccinations, family history, attachments); prescriptions + PDF + signature; lab workflow + reference ranges; pharmacy batches, FIFO, expiry quarantine, low-stock; invoices, items, Stripe/Razorpay/cash, webhooks, receipts, TPA claims; notifications (Socket.IO, Resend, Twilio) via BullMQ; patient portal; role dashboards (Recharts); global search + pagination; audit log; security checklist (14 controls); unit/integration/component/E2E tests; Nginx + SSL; AWS EC2/RDS/S3 + Vercel; seed data; README; Swagger; CI/CD |
| **Mandatory deliverables** | GitHub repo with daily commits, README, architecture diagram, ER diagram, Swagger at /api/docs, live demo, demo credentials per role, 6–10 page report, Jest coverage >70% report, 5–8 min video |
| **Optional (only after core is green)** | Google OAuth (Passport mentioned), MFA screens (folder name only), in-app chat (Socket.IO table mentions chat), Framer Motion polish, PWA, ClamAV daemon (PRD allows "or reject executables"), column-level pgcrypto beyond diagnosis/notes, blue-green automation |
| **Out of scope (PRD)** | Video consultation, DICOM viewer, AI/ML diagnostics, native mobile, HL7/FHIR |

### Hard constraint from you

No AI or LLM APIs anywhere in the app. Everything is deterministic: SQL, business rules, templates. Note the PRD already excludes AI diagnostics, so there is no conflict.

## 2. Complete technology stack

Every item below is from the PRD's approved stack or its cloud/tools tables. Nothing is swapped. Items marked *optional* are named in the PRD but not tied to a required feature.

### Frontend

| Technology | Why required | Where used | Integration |
| --- | --- | --- | --- |
| Next.js 15 App Router | PRD primary framework (SSR, RSC, routing) | `apps/web`; route groups `(auth)`, `(dashboard)`, `(portal)` | Server components fetch list-heavy pages; client components for widgets; deployed on Vercel |
| React 19 | UI library | All components | Used through Next.js |
| TypeScript (strict) | Static typing everywhere | Web, API, shared packages | Types imported from `packages/types` |
| Tailwind CSS | Styling, no custom CSS files | All UI | Shadcn components are Tailwind-based |
| Shadcn UI (Radix) | Accessible primitives | `components/ui` (never edited) | Wrapped by `components/shared` (DataTable, StatCard) |
| Framer Motion | Transitions, micro-animations | Page and card transitions | Client components only; lowest priority |
| React Hook Form + Zod | Form state + validation | Login, booking, EMR, prescription, billing forms | Zod schemas live in `packages/types` and are reused by API DTO tests |
| TanStack Query | Server state, caching, refetch | `services/*` hooks (useAppointments etc.) | Invalidated by Socket.IO events |
| Zustand | Small client state | `authStore`, `notificationStore`, `sidebarStore` | One store per domain, as PRD advises |
| Recharts | Dashboard charts | Admin/doctor/accountant dashboards | Wrapped in `'use client'` components |
| DOMPurify | XSS sanitising (PRD security table) | Anywhere user HTML/rich notes render | Frontend utility in `lib/sanitize.ts` |
| socket.io-client | Real-time in-app notifications | `useRealtime` hook | JWT in handshake, joins user and hospital rooms |
| Vitest + Testing Library, Playwright | Component and E2E tests | `apps/web` and `e2e/` | Run in CI |

### Backend

| Technology | Why required | Where used | Integration |
| --- | --- | --- | --- |
| NestJS | PRD backend framework | `apps/api`, one module per feature | Guards, interceptors, filters, DTO pipes |
| Prisma ORM + PostgreSQL 16 | Type-safe data access, migrations | `apps/api/prisma` | Client wrapped in a tenant-aware `PrismaService` (Prisma client extension) |
| Redis 7 | Refresh-token sessions, short caches, rate limits | Auth, availability and inventory caches, throttler | Same instance also backs BullMQ |
| Passport.js (JWT) | Auth strategy | `JwtStrategy` + refresh strategy | Feeds `JwtAuthGuard`, then `RolesGuard` |
| BullMQ | Background jobs | Email, SMS, push fan-out queues; reminders; PDF; nightly expiry scan; reports | Producers in services, processors in `jobs/` |
| Socket.IO (NestJS gateway) | Real-time events | `NotificationsGateway` | Rooms `user:{id}` and `hospital:{id}` keep tenancy |
| Multer + Sharp | Uploads + image optimisation | EMR attachments, doctor signature, lab PDFs | Validated, then pushed to S3 |
| class-validator + class-transformer | DTO validation (PRD) | Every endpoint | Global `ValidationPipe` with whitelist |
| @nestjs/swagger | API docs | `/api/docs` | Decorators on controllers/DTOs |
| Helmet, @nestjs/throttler, cookie-parser, csurf-style token | Security headers, rate limits, CSRF | Global bootstrap | Redis-backed throttler storage |
| bcrypt (cost 12) | Password hashing | Auth service | Never logged |
| Puppeteer | Prescription / receipt PDF from HTML | `PdfService` in a BullMQ worker | Handlebars-style HTML template with hospital letterhead |
| Jest + Supertest | Unit + integration | `apps/api` | Real test Postgres + Redis in CI services |
| Sentry | Errors from day one | API, web, workers | Initialised first in bootstrap |
| pgcrypto | Column encryption (diagnosis, notes) | Prisma raw SQL helpers in EMR repository | Only sanctioned raw SQL; key from env |

### Infrastructure

| Technology | Use |
| --- | --- |
| pnpm 9 workspaces, Node 20 LTS | Monorepo and runtime |
| Docker + Compose | postgres:16-alpine, redis:7-alpine, api, frontend, nginx (as in PRD) |
| Nginx | HTTPS redirect, SSL termination, edge rate limiting, WebSocket upgrade |
| GitHub Actions | PR: lint, `tsc --noEmit`, unit tests. Main: build images, push to ECR, integration tests on staging DB. Tag: deploy with health gate |
| AWS EC2 / RDS / S3 (+ ECR) | API host, managed Postgres, files. Neon or Supabase is the PRD-permitted fallback for Postgres |
| Vercel | Frontend hosting |
| Upstash Redis | Managed Redis permitted by PRD for production |

### Third-party services and dev/mock alternatives

The PRD requires these; the app calls them only through adapter interfaces so tests and local runs never need live keys.

| Service | Config needed | Dev / test alternative |
| --- | --- | --- |
| Stripe (test mode) | Secret key, publishable key, webhook secret | Stripe test keys + `stripe listen` CLI; for CI a `FakePaymentProvider` that signs payloads with a known secret |
| Razorpay (test mode) | Key id, key secret, webhook secret | Test keys; HMAC-SHA256 signature helper in tests |
| Resend | API key, verified sender | `EmailProvider` interface; local `ConsoleEmailProvider` or Mailpit container |
| Twilio | SID, token, from-number (trial only texts verified numbers) | `SmsProvider` interface; console/DB-log provider; OTP also visible in dev logs only |
| AWS S3 / Cloudinary | Bucket, region, keys | MinIO container (S3-compatible) in Compose; Cloudinary only if S3 is skipped |
| Sentry | DSN | Empty DSN disables it |

A single env flag per provider (`EMAIL_PROVIDER=console|resend`, `SMS_PROVIDER=console|twilio`, `STORAGE_PROVIDER=minio|s3`, `PAYMENT_PROVIDER=fake|live-test`) switches between mock and sandbox. No AI SDKs are installed.

## 3. Proposed system architecture

&#91;embedded content: system architecture · 7 components, request path top to bottom\]

The browser talks to Next.js on Vercel, API calls go through Nginx to NestJS, and the API owns every read and write to Postgres, Redis, storage and the providers. Slow side effects (email, SMS, PDF) leave the request through BullMQ.

### Architecture decisions

| Concern | Decision |
| --- | --- |
| Frontend | Server components for list/analytics pages (patients, appointments, revenue); client components for forms, charts, sockets. TanStack Query holds server state; Zustand holds auth, notifications, sidebar only. Route groups `(auth)`, `(dashboard)`, `(portal)`; middleware redirects by role. |
| Backend | NestJS modular monolith. One module per feature, each with controller, service, DTOs, repository. Modules talk through exported services or domain events, never via each other's tables, and with no circular imports. |
| Multi-tenancy | **Row-level, shared schema**: every hospital-owned table has `hospitalId`. Chosen over schema- or database-per-tenant because the PRD targets many 30 to 800 bed hospitals on one deployment and a solo developer cannot run per-tenant migrations. `hospitalId` comes only from the verified JWT, never from request body or query. A `TenantContext` (AsyncLocalStorage) feeds a Prisma client extension that injects `hospitalId` into every `where` and `data` for tenant models; Super Admin uses an explicit, audited cross-tenant client. Lookups by id use `findFirst({id, hospitalId})` so guessed ids return 404. Optional defence in depth: Postgres RLS policies on the largest tables. |
| Authentication | Access JWT (15 min) in memory; refresh token (7 days) in httpOnly, SameSite=Strict cookie, stored in Redis as `rt:{userId}:{deviceId}`, rotated on every use. Reuse of a rotated token revokes all of that user's sessions. Email OTP (6 digits) and SMS OTP are stored hashed in Redis with TTL and attempt limits. |
| RBAC | Global guard order: throttler, `JwtAuthGuard`, `TenantGuard`, `RolesGuard` (`@Roles()` decorator), then resource-level ownership checks in services (patient sees own records; doctor sees only their hospital). The permissions matrix (endpoint × 9 roles) is a checked-in file and drives the auth test suite. |
| API communication | REST under `/api` with the PRD envelope (success, error, paginated meta) enforced by a global response interceptor and exception filter. Shared request/response types in `packages/types`. |
| Real time | Socket.IO gateway authenticates the JWT at handshake, joins rooms `user:{id}` and `hospital:{id}`; the notification worker emits to rooms. Clients invalidate TanStack Query keys on events. |
| Background jobs | Separate queues per channel (`email`, `sms`, `push`, `pdf`, `reports`, `reminders`) so a failed SMS never blocks email. Retries with backoff, dead-letter handling, idempotent job ids. Repeatable jobs: nightly 30-day expiry scan; reminders scheduled at booking for T-24h and T-1h and removed on cancel. |
| Notifications | Domain events (`appointment.confirmed`, `lab.approved`, ...) go to a `NotificationService` that looks up the PRD trigger matrix, persists a `Notification` row, and enqueues one job per channel. |
| File storage | Multer memory stream, MIME + extension allow-list, 20 MB cap, executable rejection, Sharp for images, upload to S3 (MinIO in dev) under `{hospitalId}/{patientId}/...`; downloads through short-lived signed URLs after an authorisation check. |
| Security | The 14 PRD controls are each mapped to a file and a test in Section 9. Sentry initialised first. Log sanitiser strips passwords, tokens and OTPs. |
| Deployment | Compose stack (postgres, redis, api, frontend, nginx) for dev and prod-like runs; production API on EC2 behind Nginx with Let's Encrypt, DB on RDS or Neon, Redis on Upstash, frontend on Vercel. Details in Section 10. |

## 4. Monorepo folder structure

The PRD's deployment sketch uses `./backend` and `./frontend`, while its types hint says `packages/types`. This plan uses a pnpm workspace with `apps/` and `packages/`, and Compose build contexts point at `apps/api` and `apps/web`. That is a naming choice only, not a stack change.

```text
medcore-hms/
  apps/
    api/                      NestJS backend
      prisma/                 schema.prisma, migrations/, seed.ts
      src/
        main.ts, app.module.ts
        common/               guards, decorators, filters, interceptors, pipes, tenant context, logger sanitiser
        config/               typed env validation (zod), swagger setup
        infra/                prisma, redis, queue, storage, mail, sms, payments, pdf (adapters + mocks)
        modules/
          auth/ users/ hospitals/ departments/ doctors/ patients/
          availability/ appointments/ emr/ prescriptions/ lab/
          pharmacy/ billing/ payments/ notifications/ files/
          analytics/ search/ audit/
        jobs/                 BullMQ processors and schedulers
        realtime/             Socket.IO gateway
      test/                   integration (Supertest) + e2e helpers, factories
    web/                      Next.js 15 frontend
      app/(auth)/ app/(dashboard)/ app/(portal)/
      components/ui/          Shadcn (unmodified)
      components/shared/      DataTable, StatCard, EmptyState, ...
      components/modules/     AppointmentCard, PrescriptionForm, ...
      hooks/ services/ store/ lib/ constants/ types/
  packages/
    types/                    API DTO interfaces, enums, envelope types, zod schemas
    config/                   shared eslint, tsconfig, prettier
  e2e/                        Playwright specs
  docs/                       architecture.md, ER diagram, permissions-matrix.csv, report draft, ADRs
  docker/                     nginx.conf, Dockerfiles, compose.dev.yml, compose.prod.yml
  .github/workflows/          ci.yml, deploy.yml
  .vscode/settings.json
  .env.example  .gitignore  pnpm-workspace.yaml  README.md
```

| Directory | Responsibility |
| --- | --- |
| `apps/api/src/common` | Cross-cutting code: `@Roles`, `@CurrentUser`, guards, envelope interceptor, exception filter, audit interceptor, pagination helper |
| `apps/api/src/infra` | Every external dependency behind an interface with a real and a fake implementation, selected by env flag |
| `apps/api/src/modules/*` | One feature each; owns its DTOs, service rules and repository; exports only a service |
| `apps/api/src/jobs` | Queue processors, kept apart from HTTP so workers can be scaled or run as a second container |
| `apps/api/prisma` | Single source of truth for the schema, migrations and seed |
| `apps/web/app` | Routes only; data fetching and layout. Role redirects in middleware |
| `apps/web/services` | One TanStack Query hook file per module, wrapping a typed fetch client |
| `packages/types` | Contract shared by both apps; changing it breaks both builds, which is the point |
| `docs/` | Deliverables: architecture diagram, ER diagram (generated from Prisma), permissions matrix, project report |

## 5. Database design and ER planning

The PRD gives relationships only and says you must define every field. Below is the full model plan for Prisma, normalised to 3NF. Conventions: `id` is a UUID primary key; every tenant table has `hospitalId` (FK to Hospital, indexed); all tables have `createdAt`, `updatedAt`; Patient, Doctor, Appointment (and User) have `deletedAt`; money uses `Decimal(12,2)`; all enums are Prisma enums.

### Entities

| Entity | Key attributes | Keys, relations, constraints |
| --- | --- | --- |
| **Address** | line1, line2, city, state, postalCode, country | Reused by Hospital, Patient, Supplier via nullable `addressId` |
| **Hospital** | name, code (unique), email, phone, licenseNo, status (PENDING/VERIFIED/SUSPENDED), verifiedAt, settings JSON (slot length, currency, timezone), planName, planStatus (minimal subscription fields) | 1 → many User, Department, Room, etc. |
| **User** | email (unique), phone, passwordHash, role enum (9), hospitalId (null only for SUPER\_ADMIN), emailVerified, phoneVerified, isActive, lastLoginAt, deletedAt | Unique (email); index (hospitalId, role) |
| **Department** | name, description, headDoctorId? | Unique (hospitalId, name) |
| **Room / Bed** | roomNo, type, floor, capacity, status; Bed: label, occupied | Needed for the "occupied beds" KPI and room charges |
| **Doctor** | userId (1:1 unique), licenseNo, specialisation, qualification, consultationFee, signatureUrl, bio, deletedAt | Join **DoctorDepartment** (doctorId, departmentId; many-to-many, since a doctor can work in several) |
| **Patient** | userId (1:1 unique), mrn (unique per hospital), dob, gender, bloodGroup, emergencyContact, addressId, deletedAt | Unique (hospitalId, mrn) |
| **StaffProfile** | userId, employeeNo, departmentId?, designation | For nurse, receptionist, lab, pharmacist, accountant |
| **DoctorSchedule** | doctorId, departmentId, dayOfWeek, startTime, endTime, slotMinutes, validFrom, validTo, isActive | Weekly repeating rule (see decisions) |
| **ScheduleException** | doctorId, date, type (LEAVE/BLOCK/EXTRA), start, end | Overrides rule for one date |
| **Appointment** | doctorId, patientId, departmentId, scheduledAt (UTC), endAt, status enum, type (REGULAR/EMERGENCY/FOLLOW\_UP), reason, notes, cancelledReason, deletedAt | **Partial unique index** (doctorId, scheduledAt) where status not in (CANCELLED, NO\_SHOW) and type <> EMERGENCY; patient overlap checked in the same transaction |
| **MedicalRecord** | appointmentId (1:1 unique), patientId, doctorId, chiefComplaint, symptoms, diagnosisEnc (bytea), treatmentPlanEnc, notesEnc, status | Append-only parent |
| **RecordEntry** | recordId, authorId, kind (NOTE/ADDENDUM), bodyEnc, createdAt | Append-only notes; no update/delete route |
| **Vitals** | recordId, bp systolic/diastolic, pulse, tempC, spo2, heightCm, weightKg, bmi (computed in service), recordedBy | Multiple readings per encounter allowed |
| **Diagnosis** | recordId, icd10Code?, description, type (DIFFERENTIAL/CONFIRMED) | Separate rows keep it 3NF; text columns encrypted |
| **Allergy** | patientId, substance, reaction, severity, recordedAt | Patient-level, not per visit |
| **Vaccination** | patientId, vaccine, givenOn, batchNo, nextDueOn |  |
| **FamilyHistory** | patientId, condition enum (DIABETES, HYPERTENSION, CANCER, CARDIAC), relation?, present | Unique (patientId, condition) |
| **FileAttachment** | ownerType, ownerId, storageKey, mime, sizeBytes (≤ 20 MB), uploadedBy, scanStatus | Polymorphic owner: record, lab result, signature |
| **Medicine** | name, genericName, form enum, strength, reorderLevel, defaultMrp | Unique (hospitalId, name, strength) |
| **MedicineBatch** | medicineId, batchNo, mfgDate, expiryDate, quantity, unitCost, mrp, supplierId?, status (ACTIVE/QUARANTINED/DEPLETED) | Unique (medicineId, batchNo); index (medicineId, expiryDate) for FIFO |
| **Supplier** | name, contact, addressId | Uses shared Address |
| **StockMovement** | batchId, type (RECEIPT/DISPENSE/ADJUST/QUARANTINE), qty, refType, refId, userId | Ledger so stock is auditable |
| **Prescription** | recordId, doctorId, patientId, status (ISSUED/PARTIAL/DISPENSED/CANCELLED), pdfKey, signedAt | 1 record → many prescriptions |
| **PrescriptionItem** | prescriptionId, medicineId, form, dosage, frequency enum (OD/BD/TDS/QID/SOS), durationDays, instructions, quantity, dispensedQty | The many-to-many link carrying per-item data |
| **Dispense** | prescriptionItemId, batchId, qty, pharmacistId, dispensedAt | One row per batch consumed (FIFO may span batches) |
| **LabTest** | name, code, category (LAB or RADIOLOGY), unit, sampleType, price, department | Catalogue per hospital |
| **LabTestRange** | testId, gender?, ageMin, ageMax, low, high, unit | Reference ranges for out-of-range flagging |
| **LabOrder** | recordId, patientId, doctorId, status (ORDERED/SAMPLE\_COLLECTED/PROCESSING/RESULT\_UPLOADED/APPROVED/REJECTED), priority, approvedBy, approvedAt | 1 record → many orders |
| **LabOrderItem** | orderId, testId | One order has one or more tests |
| **LabResult** | orderItemId, value (numeric/text), unit, flag (NORMAL/LOW/HIGH/CRITICAL), enteredBy, reportFileId? | **Hybrid**: structured values plus optional PDF |
| **Invoice** | appointmentId (1:1 unique), patientId, invoiceNo (unique per hospital), status (DRAFT/FINAL/PARTIALLY\_PAID/PAID/VOID), subtotal, tax, discount, total, finalisedBy, finalisedAt | CHECK total = subtotal + tax − discount; total recomputed from items in one transaction |
| **InvoiceItem** | invoiceId, kind (CONSULT/LAB/PHARMACY/ROOM/OTHER), refType, refId, description, qty, unitPrice, lineTotal | CHECK lineTotal = qty × unitPrice |
| **Payment** | invoiceId, method (STRIPE/RAZORPAY/CASH), provider, providerRef (unique), amount, status, paidAt, receivedBy | Unique providerRef gives webhook idempotency |
| **WebhookEvent** | provider, eventId (unique), payloadHash, processedAt | Replay protection |
| **InsuranceClaim** | invoiceId, tpaName, policyNo, claimAmount, status (SUBMITTED/APPROVED/REJECTED/SETTLED), history | Separate TPA workflow |
| **Notification** | recipientUserId, type, title, body, entityType, entityId (polymorphic), channels, readAt | Index (recipientUserId, readAt) |
| **NotificationDelivery** | notificationId, channel, status, attempts, error | Per-channel outcome |
| **AuditLog** | userId, hospitalId, action, entityType, entityId, ip, userAgent, before/after JSON, createdAt | Append-only; every write logged |
| AdministrationNote | recordId, nurseId, medicineText, note, givenAt | Append-only nurse medication notes on an encounter; no delete path |

### Key design decisions (the PRD asks for these explicitly)

- **Availability:** store a repeating weekly rule (`DoctorSchedule`) plus `ScheduleException` overrides, and generate slots on demand with a 60 s Redis cache. Pre-generating rows would bloat the table and break whenever the rule changes.
- **Double-booking:** a partial unique index is the hard guarantee; the booking service also runs in a transaction with `SELECT ... FOR UPDATE` on the doctor's schedule row, then checks patient overlap. The loser gets `409 SLOT_UNAVAILABLE`. Pessimistic locking is chosen over optimistic because contention on a popular slot is high and a retry loop adds noise. Document this in the report.
- **Prescription items:** `PrescriptionItem` carries dosage, frequency and duration; medicine search reads the hospital's `Medicine` rows.
- **Lab results:** hybrid. Structured `LabResult` rows for analytes (so ranges and red flags work) plus an optional PDF.
- **Indexes (minimum, per PRD):** `hospitalId` on every tenant table; `patientId`; `doctorId`; `appointmentDate`; plus composite (hospitalId, status), (doctorId, scheduledAt), (patientId, scheduledAt), (medicineId, expiryDate), trigram or `ILIKE` index on patient name/MRN and medicine name for search. Confirm with `EXPLAIN ANALYZE`, as the PRD advises.
- **Soft delete:** `deletedAt` on User, Patient, Doctor, Appointment; a Prisma extension filters `deletedAt IS NULL` by default. Medical records, record entries and lab results have no delete path at all.
- **Encryption:** `diagnosis`, `treatmentPlan`, `notes` stored as `bytea` using `pgp_sym_encrypt`/`pgp_sym_decrypt` via two small, parameterised repository functions (the only raw SQL; the PRD says "never use raw()", so this exception is called out and reviewed). Key lives in env and is rotated by re-encrypt script. TLS to RDS covers in transit.
- **Audit:** a NestJS interceptor writes `AuditLog` for every POST/PATCH/PUT/DELETE with userId, hospitalId, IP, timestamp and entity; sensitive fields are redacted from the diff.
- **Money integrity:** invoice totals are never accepted from the client; they are recomputed from items inside the transaction that changes items.

### Migration strategy

1. Design on paper first (PRD: two days), then author `schema.prisma` and export the ER diagram with prisma-dbml-generator to dbdiagram.io.
2. `prisma migrate dev` creates one migration per phase (auth/tenancy, scheduling, clinical, pharmacy/lab, billing, notifications/audit); raw SQL migrations add the partial unique index, CHECK constraints, pgcrypto extension and any RLS.
3. CI runs `prisma migrate deploy` against a fresh Postgres service container; production uses `migrate deploy` only, never `dev` or `reset`.
4. Seed script is idempotent and runs on staging/demo only.

## 6. Module-by-module implementation plan

Phases are ordered by dependency. Each phase is "done" only when backend logic, DB, validation, Swagger docs, tests and the UI all work together, not when a screen exists. Dependency chain: P0 → P1 → P2 → P3 → P4 → (P5, P6, P7) → P8 → P9 (hooks added to each earlier phase) → P10 → P11 → P12–P14.

### Phase 0 — Scaffold and tooling

- **Features:** pnpm workspace, strict TS, ESLint/Prettier, `.vscode` settings, `.env.example`, Compose with postgres + redis + MinIO + Mailpit, typed env validation, Sentry init, health endpoint, GitHub repo with branch protection, first CI (lint, `tsc`, unit).
- **Files:** root configs, `docker/compose.dev.yml`, `apps/api/src/{main,app.module}.ts`, `config/env.ts`, `common/{envelope.interceptor,all-exceptions.filter}.ts`, `apps/web` created from Next.js template, `packages/types`.
- **Backend:** global prefix `/api`, `ValidationPipe`, Helmet, CORS allow-list, throttler (100/15 min auth, 1000/min API), log sanitiser, Swagger bootstrap, `GET /health`.
- **Frontend:** Tailwind + Shadcn init, `lib/apiClient`, QueryClientProvider, theme and layout shell.
- **DB:** none yet beyond connection check.
- **Packages:** `@nestjs/{config,swagger,throttler,passport,jwt,bullmq,websockets,platform-socket.io}`, `prisma`, `@prisma/client`, `ioredis`, `bullmq`, `class-validator`, `class-transformer`, `helmet`, `cookie-parser`, `bcrypt`, `zod`, `@sentry/node`, `next@15`, `react@19`, `tailwindcss`, `@tanstack/react-query`, `zustand`, `react-hook-form`, `@hookform/resolvers`, `recharts`, `framer-motion`, `dompurify`, `socket.io-client`; dev: `jest`, `ts-jest`, `supertest`, `vitest`, `@testing-library/react`, `playwright`.
- **Tests:** CI green on an empty test; envelope shape test.
- **Done when:** `docker compose up` gives healthy API + web; PR checks run; a first deploy of the API image works (PRD: deploy early).

### Phase 1 — Authentication and user management

- **Features:** register, email OTP verify, login, refresh with rotation, logout (one device / all), forgot/reset password, phone OTP, `GET /auth/me` with permissions, user admin (list, deactivate), device tracking.
- **Files:** `modules/auth/{auth.controller,auth.service,jwt.strategy,otp.service,token.service}.ts`, DTOs, `modules/users/*`, `common/guards/{jwt-auth,roles,tenant}.guard.ts`, `common/decorators/{roles,current-user,public}.ts`; web `(auth)/login|register|forgot-password|verify`, `authStore`, `useAuth`.
- **Backend:** bcrypt cost 12; OTP hashed in Redis with TTL, 5 attempts, resend cooldown; refresh in httpOnly SameSite=Strict cookie keyed `rt:{userId}:{deviceId}`; rotation with reuse detection; CSRF token on state-changing requests; auth rate limit.
- **Frontend:** forms with RHF + Zod, silent refresh on 401 via interceptor, role-based redirect, loading/error states.
- **DB:** User, plus Redis keys; audit hook on auth events.
- **Endpoints:** the nine `/auth/*` routes plus `GET /users/:id`, `GET /users`, `PATCH /users/:id`.
- **Tests:** unit for token and OTP services; integration for every happy and error path; **refresh reuse after rotation fails**; permission-matrix test generated from decorators; component tests for login form.
- **Done when:** a user can register, verify email, log in, refresh, log out everywhere; the RBAC matrix test passes for all 9 roles. PRD advises spending an extra day here.

### Phase 2 — Hospital onboarding, tenancy, departments, doctors, staff

- **Features:** Super Admin creates and verifies hospitals and the first Hospital Admin; Hospital Admin manages departments, rooms/beds, staff accounts, doctor profiles (specialisation, fee, department links, signature upload); patient registration (self or by receptionist) with MRN.
- **Files:** `modules/{hospitals,departments,doctors,patients,staff,rooms}/*`, `common/tenant/{tenant.context,prisma-tenant.extension}.ts`, `modules/files/*`; web admin screens (hospital list, department CRUD, doctor form), `DataTable`.
- **Backend:** Prisma tenant extension, soft-delete extension, address reuse, invite-by-email flow for staff, signature stored via Multer + Sharp to S3.
- **DB:** Hospital, Address, Department, Room, Doctor, DoctorDepartment, StaffProfile, Patient, FileAttachment.
- **Endpoints:** `/hospitals` (CRUD + verify), `/hospitals/:id/departments`, `/departments/:id`, `/doctors` (+ `?hospitalId=&specialisation=`), `/patients`, `/staff`, `/rooms`.
- **Tests:** **tenancy isolation suite** (write first, run in CI forever); soft-delete visibility; DTO validation.
- **Done when:** two seeded hospitals cannot see each other's data by any route, including guessed ids.

### Phase 3 — Availability, appointments and scheduling

- **Features:** weekly schedule + exceptions, slot generation with 60 s cache, booking with conflict detection, patient no-overlap rule, status lifecycle PENDING → CONFIRMED → IN\_PROGRESS → COMPLETED, plus CANCELLED / NO\_SHOW, EMERGENCY bypass, reschedule, reminders at 24 h and 1 h.
- **Files:** `modules/availability/*`, `modules/appointments/{service,controller,state-machine.ts}`, `jobs/reminder.processor.ts`; web booking wizard, doctor calendar, appointment list, status actions.
- **Backend:** transaction with row lock and partial unique index; allowed-transition table enforced server-side by role (PRD: Doctor / Receptionist change status); emergency flag skips slot check but still audited; reminder jobs scheduled/removed with the appointment.
- **DB:** DoctorSchedule, ScheduleException, Appointment.
- **Endpoints:** `GET/PUT /doctors/:id/availability`, `GET /doctors/:id/slots?date=`, `POST /appointments`, `GET /appointments`, `GET /appointments/:id`, `PATCH /appointments/:id/status`, `PATCH /appointments/:id/reschedule`, `DELETE /appointments/:id` (soft).
- **Tests:** **simultaneous booking, only one wins** (Promise.all against real DB); patient double-booking; illegal transitions; emergency bypass; slot cache invalidation.
- **Done when:** the booking journey works end to end through UI with error states.

### Phase 4 — Electronic Medical Records

- **Features:** record created when the doctor moves an appointment to IN\_PROGRESS; vitals with auto BMI; complaint and symptoms; differential and confirmed diagnoses (ICD-10 lookup from a seeded subset table); treatment plan; allergies and ADRs; vaccinations; family-history flags; file attachments ≤ 20 MB; append-only addenda; nurse can record vitals.
- **Files:** `modules/emr/{records,vitals,allergies,vaccinations,family-history,icd10}/*`, `infra/crypto/pgcrypto.repository.ts`; web encounter screen (tabs), patient chart, timeline.
- **Backend:** no PATCH/DELETE on entries, only POST addendum; encrypted columns; access check (doctor in same hospital, patient owns); view access audited.
- **DB:** MedicalRecord, RecordEntry, Vitals, Diagnosis, Allergy, Vaccination, FamilyHistory, FileAttachment, Icd10Code.
- **Endpoints:** `POST /medical-records`, `GET /medical-records/:patientId`, `POST /medical-records/:id/entries`, `POST /medical-records/:id/vitals`, `/patients/:id/allergies|vaccinations|family-history`, `POST /files` and signed download.
- **Tests:** patient cannot read another patient's record; cross-hospital doctor denied; BMI maths; append-only enforcement; MIME/size rejection; encrypted value not readable in raw SELECT.
- **Done when:** a doctor completes an encounter and the patient later sees only their own chart.

### Phase 5 — Prescriptions and PDF

- **Features:** medicine search against hospital inventory, items with form/dosage/frequency/duration/instructions, doctor signature overlay, signed PDF with hospital letterhead via Puppeteer, download and print, allergy warning against recorded allergies.
- **Files:** `modules/prescriptions/*`, `infra/pdf/{pdf.service,templates/prescription.html}`, `jobs/pdf.processor.ts`; web `PrescriptionForm`, medicine combobox with debounce.
- **Backend:** PDF rendered in a worker, stored in S3, `pdfKey` saved; ownership checks (doctor or the patient).
- **DB:** Prescription, PrescriptionItem.
- **Endpoints:** `POST /prescriptions`, `GET /prescriptions/:id`, `GET /prescriptions/:id/pdf`, `GET /medicines?search=&hospitalId=`.
- **Tests:** item validation, PDF generated and non-empty, patient-own access, allergy conflict warning.
- **Done when:** a prescription PDF with letterhead and signature downloads from both doctor and patient views.

### Phase 6 — Laboratory

- **Features:** doctor creates LabOrder with one or more tests; receptionist or lab tech marks SAMPLE\_COLLECTED; tech enters structured results and/or uploads PDF; senior lab tech / lab manager approves; auto-flag out-of-range values from reference ranges (age/gender aware); patient and doctor see the report only after approval; doctor dashboard widget for pending approvals.
- **Files:** `modules/lab/{orders,tests,results,ranges}/*`, `jobs/lab-report.processor.ts` (PDF with red flags); web order form, lab worklist, result entry, approval screen, report viewer.
- **Backend:** status machine ORDERED → SAMPLE\_COLLECTED → PROCESSING → RESULT\_UPLOADED → APPROVED/REJECTED; approver must differ from enterer; results hidden from patient role until APPROVED; invoice item added on order.
- **Role gap:** the PRD names "Senior Lab Tech or Lab Manager" but defines only one Lab Technician role. Plan: a `isSenior` flag on StaffProfile rather than a tenth role (see Section 11).
- **DB:** LabTest, LabTestRange, LabOrder, LabOrderItem, LabResult, FileAttachment.
- **Endpoints:** `POST /lab-orders`, `GET /lab-orders`, `PATCH /lab-orders/:id/sample`, `PATCH /lab-orders/:id/result`, `PATCH /lab-orders/:id/approve`, `GET /lab-orders/:id/report`, `GET/POST /lab-tests`.
- **Tests:** flagging boundaries (value equal to low/high), unapproved report invisible to patient, self-approval blocked, transitions, cross-tenant denial.
- **Done when:** order → result → approval → notification → patient download works.

### Phase 7 — Pharmacy and inventory

- **Features:** medicine catalogue, batches (batch no, mfg, expiry, qty, unit cost, MRP), FIFO dispensing by earliest expiry, low-stock alerts at configurable reorder level, expiry flagging and quarantine (cannot be dispensed), prescription verification and fulfilment (partial allowed), stock ledger, nightly 30-day expiry report to Pharmacist and Hospital Admin, cached inventory counts.
- **Files:** `modules/pharmacy/{medicines,batches,dispense,stock-ledger}/*`, `jobs/expiry-scan.processor.ts`, `jobs/low-stock.processor.ts`; web inventory table, batch form, dispense screen, alerts panel.
- **Backend:** dispense inside one transaction: lock candidate batches `FOR UPDATE`, skip expired/quarantined, consume oldest first across batches, write Dispense and StockMovement, reject with `MEDICINE_EXPIRED` or `INSUFFICIENT_STOCK`; add pharmacy invoice items; emit low-stock event when quantity crosses reorder level.
- **DB:** Medicine, MedicineBatch, Supplier, StockMovement, Dispense.
- **Endpoints:** `GET/POST /medicines`, `GET/POST /medicines/:id/batches`, `PATCH /batches/:id/quarantine`, `GET /pharmacy/prescriptions`, `POST /pharmacy/prescriptions/:id/dispense`, `GET /pharmacy/alerts` (low stock, expiring).
- **Tests:** **expired batch cannot be dispensed**, FIFO order across batches, concurrent dispense cannot oversell, reorder alert fires once, nightly job selects exactly the 30-day window.
- **Done when:** prescription → dispense → stock decrement → invoice line is consistent and auditable.

### Phase 8 — Billing and payments

- **Features:** draft invoice per appointment fed by consultation fee, lab, pharmacy, room items; add/remove items while DRAFT; finalise (Receptionist or Accountant); share with patient; pay by Stripe card, Razorpay UPI/netbanking, or cash at counter; webhook-verified confirmation sets PAID and sends receipt; partial payments; void; TPA insurance claim workflow; receipt PDF; accountant reconciliation view. PRD: wire the invoice model first, payment second, and webhooks early.
- **Files:** `modules/billing/{invoices,items,totals.ts}/*`, `modules/payments/{stripe,razorpay,cash,webhook}/*`, `modules/billing/claims/*`; web invoice editor, payment dialog, patient invoices, accountant screens.
- **Backend:** server-side total calculation in a transaction, immutable once FINAL (changes via credit note or void); `PaymentProvider` interface with Stripe, Razorpay and Fake implementations; webhook endpoints take the raw body, verify signature, dedupe by `WebhookEvent.eventId`, then update Payment and Invoice atomically; client redirect is never trusted.
- **DB:** Invoice, InvoiceItem, Payment, WebhookEvent, InsuranceClaim.
- **Endpoints:** `POST /invoices`, `GET /invoices`, `GET /invoices/:id`, `POST /invoices/:id/items`, `DELETE /invoices/:id/items/:itemId`, `PATCH /invoices/:id/finalise`, `POST /invoices/:id/pay` (creates Stripe PaymentIntent or Razorpay order), `POST /invoices/:id/cash`, `POST /payments/webhook/stripe`, `POST /payments/webhook/razorpay`, `POST/PATCH /claims`, receipt PDF.
- **Tests:** **invoice total equals sum of line items**, rounding, signed-webhook accepted, bad signature rejected, replayed event ignored, partial payment status, role matrix, simulated payment end to end.
- **Done when:** a fake and a real test-mode payment each flip an invoice to PAID and email a receipt.

### Phase 9 — Notifications

- **Features:** the PRD's eight-event matrix across email (Resend), SMS (Twilio), in-app (Socket.IO), plus inbox with unread counts and mark-read; fan-out with one queue per channel; retries; delivery log.
- **Files:** `modules/notifications/{service,controller,trigger-matrix.ts}`, `jobs/{email,sms,push}.processor.ts`, `realtime/notifications.gateway.ts`, email templates; web bell, dropdown, `notificationStore`, `useRealtime`.
- **Backend:** event emitter hooks added to appointments, lab, pharmacy, billing; staff-only low-stock; doctor SMS on emergency; in-app delivered to rooms after persisting.
- **DB:** Notification, NotificationDelivery.
- **Endpoints:** `GET /notifications/me`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`, `GET /notifications/unread-count`.
- **Tests:** matrix returns correct channels for each event; failed SMS leaves email delivered; tenant room isolation; socket auth rejects bad token.
- **Done when:** each of the eight triggers produces the right channels using mock providers, and at least one real sandbox send works.

### Phase 10 — Patient portal

- **Features:** own records and timeline, appointments (book, cancel, reschedule), prescriptions and PDFs, approved lab reports, invoices, pay online, receipts, profile and contact details, notification inbox.
- **Files:** `apps/web/app/(portal)/*`; reuses existing endpoints with "own" scoping.
- **Backend:** `/me/*` convenience routes; ownership enforcement centralised in `PatientOwnershipGuard`.
- **Frontend:** mobile-responsive layout, loading/empty/error states, accessible forms.
- **DB:** none new.
- **Tests:** Playwright journeys for registration, book appointment, pay invoice, download report; patient-isolation integration tests.
- **Done when:** a new patient completes the full portal journey unaided.

### Phase 11 — Dashboards, analytics and global search

- **Features:** Doctor dashboard (today's timeline colour-coded by status, quick patient lookup, pending lab approvals, mini follow-up calendar, recent prescriptions); Hospital Admin dashboard (KPI cards, 7-day appointment bars, department occupancy heat map, low-stock panel, recent activity from AuditLog); revenue, appointment and patient-growth charts for Admin/Accountant; Super Admin global analytics; global search with filters and pagination across patients, doctors and medicines; role-specific dashboards for nurse, receptionist, lab tech, pharmacist, accountant and patient.
- **Files:** `modules/analytics/*`, `modules/search/*`, web `(dashboard)/<role>/page.tsx`, Recharts wrappers.
- **Backend:** aggregate SQL via Prisma groupBy, date-range validation, 60 s caches for heavy aggregates, search with `ILIKE`/trigram, tenant scoped, role-limited result types (a receptionist cannot see diagnoses).
- **Endpoints:** `GET /analytics/revenue?from=&to=`, `/analytics/appointments`, `/analytics/patients-growth`, `/analytics/occupancy`, `/analytics/platform` (Super Admin), `GET /search?q=&type=&page=&limit=`.
- **Tests:** aggregates equal known seed totals, range validation, search pagination meta, tenant and role limits.
- **Done when:** every role lands on a populated dashboard from seed data.

### Phase 12 — Security hardening and audit logging

- Audit interceptor coverage verified for every mutating route; audit viewer for Hospital Admin and Super Admin.
- Walk the PRD's 14-control table and prove each with a test or a config check (Section 9). Add CSRF token flow, DOMPurify on rich text, ClamAV container or documented executable rejection, secret scanning in CI, dependency audit, Redis-backed throttler.
- **Done when:** the checklist in Section 12 shows every security row ticked with a linked test.

### Phase 13 — Testing, coverage and CI

- Raise unit coverage to 80%+ on services (PRD asks 80% in the pyramid and >70% for the deliverable report), fill gaps in integration suites, finish component and Playwright tests, publish the Jest HTML coverage report as a CI artifact, run isolation tests as a required check.

### Phase 14 — Deployment, seed, documentation and deliverables

- Production compose, Nginx and SSL, ECR images, EC2 deploy, RDS/Neon, Vercel, health-gated release, Sentry live. Seed: at least 2 hospitals, 8 doctors across specialisations, 30 patients, 2 weeks of appointment history, plus labs, prescriptions, stock and invoices, and one login per role. README, architecture and ER diagrams, Swagger at `/api/docs`, project report (6–10 pages), coverage report, video walkthrough. Details in Sections 8 and 10.

## 7. API development checklist

The PRD lists 19 "core" endpoints and the module specs add many more; the table below covers both. Routes are under `/api`. Tick each only when it has a DTO, Swagger decorators, role guard, tenant scoping, audit entry, a happy-path and an error-path test.

**Role codes:** SA Super Admin, HA Hospital Admin, DR Doctor, NU Nurse, RC Receptionist, LT Lab Technician, PH Pharmacist, AC Accountant, PT Patient. `Auth` = any authenticated user in the tenant. `own` = limited to the caller's own data.

**Envelope (all routes):** success `{success:true,data,message}`; list `{success:true,data:[],meta:{page,limit,total,totalPages}}`; error `{success:false,error:{code,message}}`. Lists accept `page`, `limit` (max 100), `sort`, `q`. Common errors: `VALIDATION_ERROR` 400 (with field details), `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404 (also returned for other tenants' ids), `CONFLICT` 409, `RATE_LIMITED` 429.

### Auth and users

| Done | Method + route | Purpose | Auth / roles | Request | Key errors |
| --- | --- | --- | --- | --- | --- |
| ☐ | POST /auth/register | Create account, send email OTP | Public | email, password (policy), name, phone, hospitalId (patients) | 409 EMAIL\_EXISTS |
| ☐ | POST /auth/verify-email | Confirm 6-digit OTP | Public | email, otp | 400 OTP\_INVALID/EXPIRED, 429 |
| ☐ | POST /auth/verify-phone | Confirm SMS OTP | Auth | phone, otp | same |
| ☐ | POST /auth/login | Access token + refresh cookie | Public | email, password | 401 INVALID\_CREDENTIALS, 403 EMAIL\_NOT\_VERIFIED |
| ☐ | POST /auth/refresh | Rotate refresh, new access | Refresh cookie | none | 401 TOKEN\_REUSED (revokes all) |
| ☐ | POST /auth/logout | Revoke this device (or `all`) | Auth | all?: boolean | none |
| ☐ | POST /auth/forgot-password | Email reset link | Public | email | always 200 (no enumeration) |
| ☐ | POST /auth/reset-password | Set new password | Reset token | token, newPassword | 400 TOKEN\_INVALID |
| ☐ | GET /auth/me | Profile + permissions | Auth | none | 401 |
| ☐ | GET /users, GET /users/:id | List / read users | SA, HA; self for :id | filters | 404 |
| ☐ | PATCH /users/:id, DELETE /users/:id | Update / deactivate (soft) | SA, HA; self (limited) | partial fields | 403 |

### Hospitals, departments, staff, doctors, patients

| Done | Method + route | Purpose | Auth / roles | Request | Key errors |
| --- | --- | --- | --- | --- | --- |
| ☐ | POST /hospitals | Onboard hospital + first admin | SA | name, code, address, adminEmail | 409 CODE\_EXISTS |
| ☐ | GET /hospitals, GET /hospitals/:id | List / read | SA (HA: own) | page, status | 404 |
| ☐ | PATCH /hospitals/:id, PATCH /hospitals/:id/verify | Edit; verify or suspend | SA (HA edit own settings) | fields / status | 409 INVALID\_STATE |
| ☐ | POST /hospitals/:id/departments | Create department | HA | name, description | 409 |
| ☐ | GET /hospitals/:id/departments | List | Hospital staff | page | 403 other tenant |
| ☐ | PATCH/DELETE /departments/:id | Edit / remove (blocked if doctors/appointments) | HA | fields | 409 IN\_USE |
| ☐ | POST /staff, GET /staff, PATCH /staff/:id | Staff accounts for the 6 non-doctor staff roles | HA | role, profile | 409 |
| ☐ | POST /doctors | Create doctor profile + user | HA | user, licenseNo, specialisation, fee, departmentIds | 409 |
| ☐ | GET /doctors?hospitalId=&specialisation= | Search doctors | Auth | filters, page | none |
| ☐ | GET/PATCH/DELETE /doctors/:id | Read / edit / soft-delete | Auth read; HA, DR(self) edit | fields | 404 |
| ☐ | POST /doctors/:id/signature | Upload signature PNG/SVG | DR(self), HA | multipart file | 415 UNSUPPORTED\_TYPE, 413 |
| ☐ | POST /patients, GET /patients, GET/PATCH/DELETE /patients/:id | Register, search, read, edit, soft-delete | RC, HA, DR, NU (PT own) | demographics | 409 DUPLICATE\_MRN |
| ☐ | CRUD /rooms, PATCH /rooms/:id/beds | Rooms and beds | HA (NU read/update status) | fields | 409 |

### Appointments and availability

| Done | Method + route | Purpose | Auth / roles | Request | Key errors |
| --- | --- | --- | --- | --- | --- |
| ☐ | GET/PUT /doctors/:id/availability | Read / replace weekly schedule | DR(self), HA | day, start, end, slotMinutes | 400 OVERLAP |
| ☐ | POST /doctors/:id/exceptions | Leave / blocked time | DR(self), HA | date, range, type | 409 HAS\_APPOINTMENTS |
| ☐ | GET /doctors/:id/slots?date= | Available slots | Auth | date | 404 |
| ☐ | POST /appointments | Book (EMERGENCY allowed for RC, DR) | PT, RC | doctorId, patientId, departmentId, scheduledAt, type, reason | 409 SLOT\_UNAVAILABLE, 409 PATIENT\_OVERLAP |
| ☐ | GET /appointments, GET /appointments/:id | List with filters / read | Staff by tenant; PT own; DR own | date, doctorId, status | 404 |
| ☐ | PATCH /appointments/:id/status | Lifecycle transition | DR, RC (PT cancel own) | status, reason? | 409 INVALID\_TRANSITION |
| ☐ | PATCH /appointments/:id/reschedule | Move to new slot | RC, PT own | scheduledAt | 409 SLOT\_UNAVAILABLE |
| ☐ | DELETE /appointments/:id | Soft delete | HA, RC | none | 409 IN\_PROGRESS |

### EMR and prescriptions

| Done | Method + route | Purpose | Auth / roles | Request | Key errors |
| --- | --- | --- | --- | --- | --- |
| ☐ | POST /medical-records | Start record for an in-progress appointment | DR | appointmentId, complaint, symptoms | 409 RECORD\_EXISTS, 409 NOT\_IN\_PROGRESS |
| ☐ | GET /medical-records/:patientId | Patient chart | DR, NU; PT own | page | 403 |
| ☐ | GET /medical-records/by-id/:id | One encounter | DR, NU; PT own | none | 404 |
| ☐ | POST /medical-records/:id/entries | Add note / addendum (append-only) | DR | body | 403 NOT\_AUTHOR\_HOSPITAL |
| ☐ | POST /medical-records/:id/vitals | Record vitals (BMI auto) | DR, NU | bp, pulse, temp, spo2, height, weight | 400 RANGE |
| ☐ | POST /medical-records/:id/diagnoses | Differential / confirmed, ICD-10 | DR | code?, text, type | 400 |
| ☐ | POST/GET /patients/:id/allergies, /vaccinations, /family-history | Histories | DR, NU (GET PT own) | per entity | 400 |
| ☐ | POST /files, GET /files/:id | Upload (≤ 20 MB) / signed URL | DR, NU, LT; PT own | multipart + owner | 415, 413 |
| ☐ | GET /icd10?q= | Code lookup | DR | q | none |
| ☐ | POST /prescriptions | Issue prescription with items | DR | recordId, items\[\] | 400 ALLERGY\_CONFLICT (warning flag), 404 MEDICINE |
| ☐ | GET /prescriptions, GET /prescriptions/:id | List / read | DR, PH, NU; PT own | filters | 404 |
| ☐ | GET /prescriptions/:id/pdf | Signed PDF | DR; PT own | none | 404, 409 PDF\_PENDING |
| ☐ | GET /medicines?search=&hospitalId= | Medicine search | PH, DR | search, page | none |

### Laboratory

| Done | Method + route | Purpose | Auth / roles | Request | Key errors |
| --- | --- | --- | --- | --- | --- |
| ☐ | GET/POST/PATCH /lab-tests | Test catalogue + ranges | HA (read: DR, LT) | name, unit, ranges | 409 |
| ☐ | POST /lab-orders | Order tests | DR | recordId, testIds\[\], priority | 400 |
| ☐ | GET /lab-orders, GET /lab-orders/:id | Worklist / read | DR, LT, RC; PT own (approved only) | status | 404 |
| ☐ | PATCH /lab-orders/:id/sample | Mark sample collected | RC, LT | collectedAt | 409 INVALID\_TRANSITION |
| ☐ | PATCH /lab-orders/:id/result | Enter / upload results | LT | values\[\] or file | 400 |
| ☐ | PATCH /lab-orders/:id/approve (and /reject) | Approve report | LT (senior) | note | 403 SELF\_APPROVAL, 409 |
| ☐ | GET /lab-orders/:id/report | Report PDF (flags in red) | DR; PT own after approval | none | 403 NOT\_APPROVED |

### Pharmacy

| Done | Method + route | Purpose | Auth / roles | Request | Key errors |
| --- | --- | --- | --- | --- | --- |
| ☐ | POST /medicines, PATCH /medicines/:id | Catalogue, reorder level | PH, HA | fields | 409 |
| ☐ | POST /medicines/:id/batches | Receive stock | PH | batchNo, mfg, expiry, qty, cost, mrp | 400 EXPIRY\_IN\_PAST |
| ☐ | GET /medicines/:id/batches | Batches ordered FIFO | PH | none | 404 |
| ☐ | PATCH /batches/:id/quarantine | Quarantine expired / damaged | PH | reason | 409 |
| ☐ | GET /pharmacy/prescriptions | Verification queue | PH | status | none |
| ☐ | POST /pharmacy/prescriptions/:id/dispense | Verify + dispense FIFO | PH | items\[{itemId,qty}\] | 422 MEDICINE\_EXPIRED, 422 INSUFFICIENT\_STOCK |
| ☐ | GET /pharmacy/alerts | Low stock + expiring in 30 days | PH, HA | days | none |

### Billing, payments, claims

| Done | Method + route | Purpose | Auth / roles | Request | Key errors |
| --- | --- | --- | --- | --- | --- |
| ☐ | POST /invoices | Draft invoice for appointment | RC, AC | appointmentId | 409 INVOICE\_EXISTS |
| ☐ | GET /invoices, GET /invoices/:id | List / read | RC, AC, HA; PT own | status, dates | 404 |
| ☐ | POST /invoices/:id/items, DELETE /invoices/:id/items/:itemId | Edit lines while DRAFT | RC, AC | kind, description, qty, unitPrice | 409 NOT\_DRAFT |
| ☐ | PATCH /invoices/:id/finalise, /void | Lock or void | RC, AC | reason (void) | 409 |
| ☐ | POST /invoices/:id/pay | Create Stripe intent or Razorpay order | PT own, RC | provider | 409 ALREADY\_PAID |
| ☐ | POST /invoices/:id/cash | Record cash | RC, AC | amount | 400 EXCEEDS\_BALANCE |
| ☐ | POST /payments/webhook/stripe | Verified payment event | Stripe signature | raw body | 400 BAD\_SIGNATURE, 200 on duplicate |
| ☐ | POST /payments/webhook/razorpay | Same for Razorpay | Razorpay signature | raw body | same |
| ☐ | GET /invoices/:id/receipt | Receipt PDF | RC, AC; PT own | none | 409 NOT\_PAID |
| ☐ | POST/GET/PATCH /claims | TPA claim workflow | AC | invoiceId, tpa, policyNo, amount | 409 |

### Notifications, analytics, search, audit

| Done | Method + route | Purpose | Auth / roles | Request | Key errors |
| --- | --- | --- | --- | --- | --- |
| ☐ | GET /notifications/me, PATCH /notifications/:id/read, PATCH /notifications/read-all, GET /notifications/unread-count | Inbox | Auth | page, unreadOnly | 404 |
| ☐ | GET /analytics/revenue?from=&to= | Revenue series | HA, AC (SA all) | from, to, groupBy | 400 RANGE |
| ☐ | GET /analytics/appointments, /patients-growth, /occupancy, /dashboard/:role | Chart data and KPIs | per dashboard role | range | 400 |
| ☐ | GET /analytics/platform | Global stats | SA | range | 403 |
| ☐ | GET /search?q=&type=&filters=&page= | Global search (patients, doctors, medicines) | Auth, results role-filtered | q (min 2 chars) | 400 |
| ☐ | GET /audit-logs | Audit viewer | HA (tenant), SA | userId, entity, dates | 403 |
| ☐ | GET /health | Liveness / readiness | Public | none | 503 |

## 8. Four-week development roadmap

&#91;embedded content: four-week roadmap · 4 weeks, 4 gates; week 3 is the highest-risk\]

The plan assumes 28 consecutive working days of focused effort (the PRD asks for daily commits). Week 3 is highlighted because it carries lab, pharmacy, billing, notifications and the portal, which is more than any other week. Rule for the whole schedule: build thin end-to-end first, deepen later; never mark a day done without tests for what shipped.

### Daily plan

| Day | Tasks | Depends on | Checkpoint / deliverable |
| --- | --- | --- | --- |
| **1** | Create repo, pnpm workspace, tooling, Compose (Postgres, Redis, MinIO, Mailpit), `.env.example`, Sentry, CI skeleton, branch protection. Begin ER diagram on paper from one real hospital workflow | None | `docker compose up` healthy; CI green |
| **2** | Finish ER diagram; write full Prisma schema (all entities in Section 5); first migration; permissions matrix CSV (endpoint × 9 roles) | D1 | Schema reviewed; ER diagram exported; no API code yet |
| **3** | Auth backend: register, email OTP, login, JWT, refresh in Redis with rotation, logout, forgot/reset; first EC2 deploy of API health endpoint | D2 | Auth integration tests pass; deploy pipeline proven |
| **4** | RBAC guards (`@Roles`), tenant context + Prisma extension, envelope + error filter, audit interceptor, phone OTP; write tenancy isolation and refresh-reuse tests | D3 | **Integration checkpoint:** matrix test + isolation test in CI |
| **5** | Auth UI (login, register, verify, reset), auth store, silent refresh, role redirect; hospital onboarding (Super Admin create/verify) | D4 | Super Admin can create a hospital in the UI |
| **6** | Departments, staff accounts, doctor profiles (with signature upload), patients, rooms; admin screens | D5 | Hospital Admin can set up a hospital end to end |
| **7** | Buffer and integration: Swagger decorators, seed v1 (2 hospitals), fix backlog, review ER vs code | D6 | **Week 1 gate:** isolation tests green, seed runs |
| **8** | Availability rules, exceptions, slot generation with 60 s cache | D7 | Slot API correct for edge cases |
| **9** | Booking engine: transaction, row lock, partial unique index, patient-overlap rule, status state machine, emergency flag; concurrency test | D8 | Simultaneous booking: exactly one wins |
| **10** | Booking UI (calendar, wizard, lists, status actions), reminder jobs (24 h, 1 h), reschedule/cancel | D9 | Receptionist and patient can book from UI |
| **11** | EMR backend: record creation, vitals + BMI, diagnoses (ICD-10 subset), histories, append-only entries, pgcrypto helpers, attachments | D9 | EMR unit + integration tests |
| **12** | EMR UI: encounter screen, patient chart, attachment upload; patient/other-tenant access tests | D11 | Doctor completes a documented encounter |
| **13** | Prescriptions: backend, medicine search (seed small catalogue), Puppeteer PDF worker, form UI | D12 | PDF with letterhead and signature downloads |
| **14** | Integration: register → book → encounter → prescription; first Playwright spec; deploy staging | D13 | **Week 2 gate:** booking journey E2E passes |
| **15** | **Billing first (PRD hint):** Invoice, items, totals, finalise, void; invoice UI skeleton; billing-integrity test | D14 | Invoice total equals line items |
| **16** | Payments: provider interface, Stripe + Razorpay + Fake, cash, webhook signature + idempotency, receipt job; simulated webhook test | D15 | Webhook flips invoice to PAID in tests |
| **17** | Lab backend + minimal UI: catalogue, ranges, order, sample, result entry, approval, invoice hook | D14, D15 | Order to approved report works |
| **18** | Pharmacy backend: medicines, batches, FIFO dispense, expiry quarantine, low-stock, nightly expiry job | D13, D15 | Expired medicine rejected; FIFO test |
| **19** | Pharmacy UI + dispense screen; lab UI polish and report PDF with red flags; TPA claims basic workflow | D17, D18 | Both workflows usable |
| **20** | Notifications: trigger matrix, queues, Resend/Twilio adapters, Socket.IO gateway, bell UI, wire all 8 triggers | D16–D19 | Each trigger delivers via mock providers |
| **21** | Patient portal (records, reports, invoices, payments); integration pass; staging deploy | D20 | **Week 3 gate:** webhook test + portal journey |
| **22** | Analytics endpoints; doctor and hospital-admin dashboards with Recharts | D21 | KPI numbers match seed data |
| **23** | Remaining role dashboards; global search with filters and pagination | D22 | Every role has a populated landing page |
| **24** | Security pass: CSRF, upload validation + scan/reject, rate limits, headers, audit viewer, pgcrypto proof, log sanitiser; map all 14 controls to tests | D21 | Security table fully evidenced |
| **25** | Test push: unit coverage to 80%+ on services, integration gaps, component tests; fix defects found | D24 | Coverage report > 70% overall |
| **26** | Playwright: registration, book, pay invoice, download report; full CI pipeline; production compose, Nginx, SSL | D25 | CI green on main |
| **27** | Production deploy: EC2 + RDS/Neon + Upstash + Vercel; migrations; demo seed; smoke tests; Sentry check | D26 | Live demo URL works |
| **28** | README, architecture + ER diagrams, Swagger check, project report, coverage artifact, demo credentials, video | D27 | **Week 4 gate:** all deliverables present |

### Where the schedule will likely overrun, and how to cope without dropping requirements

| Risk | Why | Mitigation that keeps the requirement |
| --- | --- | --- |
| Billing and payment webhooks | PRD itself warns it always runs long; signature handling and idempotency are fiddly | Interface + Fake provider first (Day 15–16), live test-mode keys last; keep the cash path working so the flow is never blocked |
| Week 3 volume (six modules) | Largest scope in the shortest span | Build backend and tests per module first, minimal tables/forms for UI, polish in Week 4 after dashboards; start Week 3 notification hooks as one-line event emits earlier |
| Prescription PDFs via Puppeteer | Chromium in Docker is heavy and slow | Start with one HTML template; install Chromium in the API image on Day 13; run in worker; keep a simple fallback only if Chromium fails on EC2 t2.micro |
| Deployment on t2.micro | 1 GB RAM for API, worker, Chromium, Nginx | Deploy on Day 3 and Day 14 to learn early; add swap; run workers in the same container; PRD allows Neon/Supabase and Upstash to reduce load |
| Twilio trial limits | Only verified numbers can receive SMS | Console SMS provider as default; verify demo numbers in Twilio; document the limit |
| Frontend volume | Nine roles with distinct dashboards | Shared `DataTable`, `StatCard`, `FormField` components built in Week 1; dashboards are config-driven by role |
| Test debt | Easily postponed | Isolation, rotation, concurrency, expiry and billing-integrity tests are written on the same day as their feature (see Section 9) |
| Solo capacity | 28 days is aggressive for the whole scope | If a day slips, first use Day 7, Day 28 and optional-list items (Section 1) as buffer; if still short, reduce UI polish and animations, not backend rules, security, tests or any mandatory module. Record deliberate shortfalls in the project report |

## 9. Testing and quality assurance strategy

Tests follow the PRD pyramid. Integration tests run against a real Postgres and Redis (CI service containers), never mocks of the database, because tenancy, locking and constraints are the things most likely to break.

| Layer | Tool | Scope | Target |
| --- | --- | --- | --- |
| Unit | Jest | Services, state machines, BMI, totals, FIFO selector, range flagging, slot generator, Zod schemas, utilities | 80%+ on services (PRD), >70% overall for the deliverable report |
| Integration | Jest + Supertest | Every endpoint, happy and error path, with real DB; factories for hospitals, users per role | All routes in Section 7 |
| Component | Vitest + Testing Library | Forms (login, booking, prescription, invoice), conditional rendering, error states | Key forms and tables |
| End to end | Playwright | Registration, book appointment, pay invoice, download report | 4 journeys, run on staging in CI |

### Mandatory PRD scenarios and how each is tested

| PRD scenario | Test design | Written |
| --- | --- | --- |
| Doctor cannot access another hospital's records | Seed hospitals A and B. Doctor A requests B's patient, record, appointment, invoice by id: expect 404 on every route (generated by iterating the route list). Also list endpoints return zero B rows. CI required check | Day 4 |
| Patient cannot view another patient's records | Patient P1 token against P2's `/medical-records/:id`, prescriptions, lab reports, invoices: 403/404 | Day 12 |
| Two simultaneous bookings, one wins | `Promise.all` of two `POST /appointments` for the same doctor and slot; assert one 201, one 409 `SLOT_UNAVAILABLE`, exactly one DB row. Repeat 20 times to catch races | Day 9 |
| Refresh token cannot be reused after rotation | Login, refresh once, send old token again: 401 and all device sessions revoked | Day 4 |
| Expired medicine cannot be dispensed | Batch with past expiry: dispense returns 422 `MEDICINE_EXPIRED`; stock unchanged; with a valid newer batch present, FIFO uses the valid batch only | Day 18 |
| Invoice total equals sum of line items | Property-style test: random items, tax and discount; assert `total = Σ lineTotal + tax − discount` to 2 decimals after every add/remove; DB CHECK rejects a tampered total | Day 15 |
| Simulated payment webhook | Signed payload accepted and invoice PAID; bad signature rejected; duplicate event ignored; client-reported success without webhook changes nothing | Day 16 |

### Further test areas

- **Authentication and authorisation:** the permission matrix CSV drives a generated test that calls every endpoint with all 9 roles and asserts allow/deny. Also expired token, tampered JWT, deactivated user, wrong tenant claim, OTP attempt limit, rate-limit 429 on auth endpoints.
- **Multi-tenant isolation:** besides routes, test BullMQ jobs and Socket.IO rooms (a user must not receive another hospital's events), search and analytics aggregates, and file download URLs.
- **Appointment concurrency:** the double-booking test above, plus concurrent reschedule and concurrent status change; emergency bookings still allowed.
- **Billing integrity:** rounding, immutable finalised invoices, partial payments, void, replayed webhooks, payments exceeding balance.
- **Pharmacy:** FIFO across batches, concurrent dispense cannot make stock negative, quarantined stock excluded, low-stock alert emitted once per crossing, nightly job window exactly 30 days.
- **API error handling:** every error code returns the envelope; validation errors list fields; 500s never leak stack traces; unknown routes return the envelope; Prisma errors map to 404/409.
- **Security checks as tests:** bcrypt cost ≥ 12, cookie flags, Helmet headers present, CORS rejects unlisted origins, upload of `.exe` or mismatched MIME refused, 21 MB file refused, secrets absent from logs, encrypted columns unreadable in raw SQL.
- **Frontend:** loading, empty and error states for each list; keyboard and label checks on forms; role-based navigation hides links the API would reject.

### CI gates

On PR: ESLint, Prettier check, `tsc --noEmit` on all packages, unit and integration tests with coverage threshold, tenancy suite as a separately named required check, `pnpm audit`. On main: build images, run Playwright against staging. Coverage HTML is uploaded as an artifact for the deliverable.

## 10. Deployment and DevOps strategy

| Area | Plan |
| --- | --- |
| Local environment | Node 20, pnpm 9, Docker Desktop, Git 2.40+. `pnpm i`, `cp .env.example .env`, `docker compose -f docker/compose.dev.yml up -d postgres redis minio mailpit`, then `pnpm --filter api prisma migrate dev && pnpm --filter api seed`, `pnpm dev`. VS Code extensions per PRD; `.vscode/settings.json` committed for format/lint on save |
| Docker Compose | Dev file: postgres:16-alpine, redis:7-alpine, MinIO, Mailpit, optional api/web. Prod file: api, web (optional if on Vercel), nginx, worker (same image, different command). Health checks, named volumes, restart policies, API waits for DB with `depends_on: condition: service_healthy` |
| PostgreSQL and Redis | Dev in containers. Prod: RDS t3.micro (or Neon/Supabase if skipping RDS) with TLS, automated backups; Upstash Redis with TLS and `maxmemory-policy noeviction` for queues. Enable `pgcrypto` in the first migration |
| Environment variables | Typed and validated at boot. Groups: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (each 256-bit random), `ENCRYPTION_KEY`, `CORS_ORIGINS`, `COOKIE_DOMAIN`, provider flags (`EMAIL_PROVIDER`, `SMS_PROVIDER`, `STORAGE_PROVIDER`, `PAYMENT_PROVIDER`), `RESEND_API_KEY`, `TWILIO_*`, `STRIPE_*`, `RAZORPAY_*`, `S3_*`, `SENTRY_DSN`, `NEXT_PUBLIC_API_URL`. `.env` is gitignored from the first commit; `.env.example` documents every variable; production secrets live in GitHub Actions secrets and EC2 environment or AWS SSM |
| Git and branching | Trunk-based with short-lived branches: `feat/<module>-<topic>`, `fix/...`, protected `main` (PR + passing CI, no direct pushes). Conventional commits, at least one commit per day, tags `v0.1.0` per week and `v1.0.0` for release |
| GitHub Actions | `ci.yml` on PR: lint, type-check, unit + integration (Postgres/Redis services), tenancy suite, coverage artifact. `main` push: build and push API image to ECR, run integration tests against staging DB. `deploy.yml` on release tag: pull image on EC2, run `prisma migrate deploy`, start new container, health-check gate, switch Nginx upstream (blue-green), roll back on failed check |
| Backend deployment | EC2 (t2.micro, add swap) running Compose with Nginx; Let's Encrypt via certbot with auto-renew; HTTP redirects to HTTPS; Nginx edge rate limits and WebSocket upgrade headers; security group opens only 80/443/SSH-from-my-IP |
| Frontend deployment | Vercel project on `apps/web`; env `NEXT_PUBLIC_API_URL`; preview deployments per PR; API CORS allow-list contains the Vercel domain; cookie domain and SameSite settings tested across the two domains (see risks) |
| Production database | Migrations only through `migrate deploy`; seed demo data once via a guarded script; backups verified; no `migrate reset` in prod |
| Observability | Sentry in API, web and workers from Day 1; structured logs with sanitiser; `/health` used by Nginx and the deploy gate |
| Swagger | `@nestjs/swagger` configured in `main.ts`, UI at `/api/docs`, bearer auth, tags per module, every DTO with `@ApiProperty`, error responses documented; exported JSON stored in `docs/` |
| Documentation | `README.md`: overview, architecture diagram, stack, local setup, env table, scripts, API base URL, demo credentials per role, test commands. `docs/architecture.md`, ER diagram (from Prisma via dbdiagram.io), permissions matrix, ADRs for tenancy, locking and encryption, 6–10 page project report, coverage report, video script |

## 11. Risks, contradictions, ambiguities and blockers

Each row has a default decision so work is never blocked. Items marked **Decide** are worth confirming with your examiner or guide before Day 2, because they change the schema.

### Contradictions inside the PRD

| # | Finding | Default in this plan |
| --- | --- | --- |
| C1 | Encryption: section 7.3 hint lets you choose column encryption *or* document why row-level security is enough, but the security table says sensitive columns are **encrypted using pgcrypto** and calls the list non-negotiable | Implement pgcrypto for diagnosis, treatment plan and notes; document RLS as extra |
| C2 | "Never use raw()" (SQL injection row) vs pgcrypto, which Prisma cannot call without raw SQL | Two parameterised `$queryRaw` helpers, reviewed and explained in the report; no string-built SQL anywhere |
| C3 | Coverage target is 80%+ in the testing pyramid but >70% in deliverables | Gate CI at 70% overall, aim for 80% on services |
| C4 | Compose sample builds `./backend` and `./frontend`, while the types hint requires `packages/types` | Monorepo with `apps/*` and `packages/*`; update Compose paths |
| C5 | Emergency bookings "bypass slot availability" but "a patient cannot have two appointments at the same time" | Emergency bypasses the doctor's slot rules only; patient overlap still blocked unless the earlier one is cancelled |
| C6 | CI says integration tests run "against staging DB" and deploy is "blue-green", but the hosting is one free-tier EC2 t2.micro | Use a separate staging schema/DB; blue-green by two containers behind Nginx if memory allows, else rolling restart with health gate |
| C7 | Week 2 hint says to start with auth and RBAC, though auth is Week 1 scope | Treated as a general reminder; auth is Days 3–4 |

### Ambiguities and missing specifications

| # | Gap | Default in this plan | Decide |
| --- | --- | --- | --- |
| A1 | "Senior Lab Tech or Lab Manager" approves reports but only 9 roles exist | `isSenior` flag on Lab Technician; approver ≠ enterer | Yes |
| A2 | Doctor "lab/radiology orders" but DICOM is out of scope and no radiology module exists | Radiology as a LabTest category: order, result text, report file; no image viewer | Yes |
| A3 | Nurse "medication administration notes, ward management" are not specified; beds and "occupied beds" KPI have no admission workflow | Small `AdministrationNote` table on the record; Room/Bed with status; occupancy = occupied beds / total; no full IPD admission module | Yes |
| A4 | Super Admin "subscription billing" is not specified | Plan and status fields on Hospital, shown in global analytics; no subscription payments | Yes |
| A5 | Who moves PENDING → CONFIRMED? | Patient-booked = PENDING, Receptionist or Doctor confirms; Receptionist-booked = CONFIRMED directly | No |
| A6 | Email uniqueness across hospitals; a patient can belong to only one hospital (1:1 User) | Global unique email; one hospital per patient/staff in v1; documented limitation | Yes |
| A7 | Timezone and currency | Store UTC, hospital timezone in settings (default Asia/Kolkata); INR default | No |
| A8 | "Invoice per visit" vs room charges and walk-in pharmacy sales | One invoice per appointment; walk-in sales create an appointment-less OTHER invoice only if a decision is made | Yes |
| A9 | Tax, discount, refunds, partial payments, GST not specified | Tax and discount fields supported; partial payments allowed; refunds out of scope but noted | No |
| A10 | Notification matrix: "in-app push" for lab reports; 1-hour reminder channels missing; no web-push in stack | Treat push as Socket.IO in-app; 1 h reminder uses email + SMS like 24 h | No |
| A11 | Google OAuth (Passport) and MFA screens appear but no endpoint or requirement | Optional, last priority | No |
| A12 | Chat appears in the Socket.IO description only | Not built; counted as optional | No |
| A13 | "Signed PDF" and digital signature | Image overlay of the doctor's stored signature plus timestamp and prescription hash, not a cryptographic signature | No |
| A14 | Routes in the PRD have no prefix, while Swagger is at `/api/docs` | Global prefix `/api`, so `/auth/login` is served at `/api/auth/login`; document in README | No |
| A15 | PRD calls the product "HIPAA-aware" while targeting India and SE Asia | Say "HIPAA-aware controls" only; mention India's DPDP Act in the report; make no compliance claims | No |
| A16 | Staff onboarding (invite vs admin-created passwords) is unspecified | Admin creates the account and an email invite sets the password | No |

### Technical risks

| # | Risk | Mitigation |
| --- | --- | --- |
| T1 | **Cross-site cookies:** frontend on `*.vercel.app` and API on another domain makes a SameSite=Strict refresh cookie unusable | Use a custom domain with both under one registrable domain (`app.` and `api.`), or proxy API calls through Next.js rewrites so the browser sees one origin; test on Day 3 |
| T2 | Tenant leak through a missing `hospitalId` filter | Prisma extension, not hand-written filters; route-iterating isolation test as a required CI check; optional Postgres RLS |
| T3 | Race conditions: double booking, oversell, double webhook | Row locks, partial unique index, idempotent webhooks, concurrency tests |
| T4 | Puppeteer memory and image size on t2.micro | Single Chromium instance in the worker, `--no-sandbox` flags in container, swap file; fallback is a lighter HTML-to-PDF path only if Chromium cannot run |
| T5 | Encrypted columns cannot be searched | Search only on non-encrypted fields (name, MRN, ICD code); document this |
| T6 | Prisma and partial unique index / CHECK constraints | Add via raw SQL migrations and keep Prisma schema in sync with `@@ignore` notes |
| T7 | Jobs failing silently | Sentry in workers, queue event logging, dead-letter handling, admin-visible failed deliveries |
| T8 | Scope too large for 28 days | Section 8 mitigations; backend rules and tests before UI polish; never cut mandatory modules |
| T9 | WebSockets through Nginx and Vercel | Sockets connect to the API host, Nginx forwards `Upgrade` headers; polling fallback |
| T10 | Schema churn | Two days of design first, one migration per phase, no edits to applied migrations |

### External dependencies and blockers

| # | Dependency | Why it blocks | Action |
| --- | --- | --- | --- |
| B1 | A domain name | Let's Encrypt cannot issue certificates for a raw EC2 IP; cookies need a stable domain | Buy or obtain a student domain by Week 2; free subdomain services work for demos |
| B2 | Resend domain verification | Free tier sends only to the account owner until a domain is verified | Verify the same domain; until then use Mailpit and a console provider |
| B3 | Twilio trial and India SMS rules | Trial sends only to verified numbers; Indian SMS commonly needs DLT registration | Verify demo numbers; keep SMS adapter swappable; show OTP in dev logs only |
| B4 | Stripe and Razorpay accounts | Need sign-up, test keys and webhook secrets; webhook delivery needs a public URL | Use Stripe CLI / ngrok locally; Fake provider for CI; configure real webhooks after first deploy |
| B5 | AWS account and free-tier limits | EC2, RDS, S3, ECR all need setup and a payment method | Create account early; use Neon/Supabase and Upstash if AWS limits bite |
| B6 | ClamAV | Needs around 1 GB RAM, too heavy for t2.micro | PRD allows rejecting executables; do MIME + extension + magic-byte checks, run ClamAV only locally if time permits |
| B7 | Puppeteer on EC2 | Needs system libraries in the image | Pin a Chromium-ready base image and test on Day 13 |

## 12. Master checklist of every PRD requirement

Tick an item only when backend logic, database, validation, tests and (where relevant) UI all work. **M** = mandatory, **O** = optional.

### Scope, setup and architecture

- [ ] M Monorepo, Docker Compose, environment config, `.env.example`, `.env` ignored
- [ ] M Layered architecture; REST API consumed by Next.js; WebSocket channel
- [ ] M Multi-tenancy: `hospitalId` on every tenant table, enforced on every request, Super Admin cross-tenant, others scoped at login; approach justified in the report
- [ ] M Redis used for refresh sessions, short caches (availability TTL 60 s, medicine counts) and rate limiting
- [ ] M Nginx reverse proxy and SSL; Sentry from day one
- [ ] M Shared types package used by web and api

### Database

- [ ] M Prisma schema normalised to 3NF with complete field lists and migrations
- [ ] M Entities: Hospital, User, Department, Room, Doctor, Patient, Appointment, MedicalRecord, Prescription (+Item), LabOrder, Invoice (+Item), Notification, AuditLog, Address
- [ ] M Separate reusable Address model
- [ ] M Soft delete (`deletedAt`) on Patient, Doctor, Appointment; medical records never hard-deleted
- [ ] M Indexes: hospitalId, patientId, doctorId, appointmentDate and columns used in WHERE; confirmed with EXPLAIN ANALYZE
- [ ] M Design decisions documented: availability storage, prescription many-to-many, lab result storage
- [ ] M Column encryption (diagnosis, notes) with pgcrypto
- [ ] M Seed: ≥ 2 hospitals, 8 doctors in different specialisations, 30 patients, 2 weeks of appointment history

### Authentication and RBAC

- [ ] M POST /auth/register, /login, /refresh, /forgot-password, /reset-password, /verify-email, /verify-phone, /logout; GET /auth/me
- [ ] M Access token 15 min; refresh token 7 days in httpOnly cookie; key `rt:{userId}:{deviceId}`; rotation; logout one or all devices
- [ ] M 6-digit email OTP; SMS OTP via Twilio
- [ ] M bcrypt cost ≥ 12; log sanitiser (no passwords, tokens, OTPs)
- [ ] M Guards and `@Roles()` for all 9 roles; permissions matrix (endpoint × role) as the test specification
- [ ] O Google OAuth; MFA screens

### Hospital, departments, doctors

- [ ] M Super Admin creates and verifies hospitals
- [ ] M Hospital Admin manages departments, staff, beds, hospital analytics, billing config
- [ ] M Department and doctor profile setup; doctor in one or more departments
- [ ] M GET /hospitals, /hospitals/:id/departments, /doctors?hospitalId=&specialisation=, /users/:id

### Appointments

- [ ] M Weekly availability with configurable slots (e.g. 9:00–13:00, 30 min)
- [ ] M Booking with conflict detection; patient cannot overlap across doctors
- [ ] M Concurrency control (SELECT FOR UPDATE or optimistic), reasoning documented
- [ ] M States PENDING → CONFIRMED → IN\_PROGRESS → COMPLETED | CANCELLED | NO\_SHOW
- [ ] M Emergency bookings bypass slot availability and are flagged EMERGENCY
- [ ] M Reminders 24 h and 1 h before via email + SMS (BullMQ)
- [ ] M POST /appointments; PATCH /appointments/:id/status

### EMR

- [ ] M Record created in an encounter; append-only
- [ ] M Vitals (BP, pulse, temperature, SpO2, height, weight, BMI auto-calculated)
- [ ] M Chief complaint and symptoms; differential and confirmed diagnoses with ICD-10
- [ ] M Treatment plan; allergies and adverse drug reactions; medication history
- [ ] M Vaccination history (date, name, batch number, next due); family history flags (diabetes, hypertension, cancer, cardiac)
- [ ] M Attachments in S3, max 20 MB, MIME and extension validation
- [ ] M POST /medical-records; GET /medical-records/:patientId

### Prescriptions

- [ ] M Medicine search from pharmacy inventory; form (tablet, capsule, syrup, injection, topical); dosage; frequency OD/BD/TDS/QID/SOS; duration; special instructions
- [ ] M Doctor signature stored as SVG/PNG and overlaid on a PDF generated with Puppeteer; hospital letterhead
- [ ] M POST /prescriptions; GET /prescriptions/:id/pdf (doctor, patient own)

### Laboratory

- [ ] M Doctor creates order with one or more tests
- [ ] M Receptionist or lab tech marks SAMPLE\_COLLECTED
- [ ] M Lab tech uploads structured result or PDF
- [ ] M Senior lab tech or manager approves; patient and doctor notified; visible only after approval
- [ ] M Reference ranges stored; out-of-range values flagged in red
- [ ] M POST /lab-orders; PATCH /lab-orders/:id/result

### Pharmacy

- [ ] M Batches with batch number, manufacturing date, expiry, quantity, unit cost, MRP
- [ ] M FIFO dispensing; low-stock alert at configurable reorder level
- [ ] M Expired stock flagged, quarantined and never dispensed
- [ ] M Prescription verification and fulfilment
- [ ] M Nightly BullMQ job: medicines expiring within 30 days reported to Pharmacist and Hospital Admin
- [ ] M GET /medicines?search=&hospitalId=

### Billing and payments

- [ ] M Draft invoice receives items from consultation, lab, pharmacy, room; one invoice per visit
- [ ] M Receptionist or Accountant finalises and shares
- [ ] M Pay by Stripe card, Razorpay UPI/netbanking, or cash
- [ ] M Payment confirmation sets PAID and emails a receipt; confirmation only from verified webhooks
- [ ] M Insurance claims through a TPA workflow
- [ ] M POST /invoices; POST /payments/webhook/stripe (signature verified); simulated webhook test
- [ ] M Accountant: financial reports, claims, reconciliation

### Notifications

- [ ] M Event bus with fan-out handlers, one queue per channel
- [ ] M Matrix: appointment confirmed (email, SMS, in-app); 24 h reminder (email, SMS); lab approved (email, in-app); prescription ready (SMS, in-app); invoice generated (email, in-app); payment received (email, SMS); low stock (email, in-app, staff only); emergency appointment (in-app, SMS to doctor)
- [ ] M GET /notifications/me; Socket.IO real-time in-app delivery

### Patient portal and dashboards

- [ ] M Portal: view records, download reports, track invoices, pay, book appointments
- [ ] M Doctor dashboard: today's timeline colour-coded by status, patient lookup, pending lab approvals, follow-up mini calendar, recent prescriptions
- [ ] M Hospital Admin dashboard: KPI cards (patients today, revenue today, occupied beds, active doctors), 7-day appointment bars, department occupancy heat map, low-stock panel, recent activity
- [ ] M Recharts for revenue, appointments, patient growth; dashboards for every role
- [ ] M GET /analytics/revenue?from=&to=; global search with filters and pagination (patients, doctors, medicines)

### Frontend

- [ ] M Next.js 15 App Router, React 19, TypeScript strict, Tailwind only, Shadcn, React Hook Form + Zod, TanStack Query, Zustand
- [ ] M Route groups `(auth)`, `(dashboard)`, `(portal)`; folders components/ui, shared, modules, hooks, services, store, types, lib, constants
- [ ] M Loading, error and empty states; responsive; accessible
- [ ] O Framer Motion transitions; PWA

### Security

- [ ] M bcrypt ≥ 12 · HTTPS everywhere with HTTP redirect · 256-bit JWT secrets in env only
- [ ] M Refresh rotation · rate limits (100 per 15 min per IP on auth, 1000 per min on API) · strict CORS allow-list · Helmet
- [ ] M No raw SQL except the reviewed pgcrypto helpers · DOMPurify · SameSite=Strict + CSRF token
- [ ] M Zod + class-validator DTOs · audit log on every create/update/delete with userId, IP, timestamp
- [ ] M File upload MIME + extension validation, executable rejection or ClamAV · pgcrypto encrypted columns

### API contract and docs

- [ ] M Standard envelopes (success, error, paginated) on every route
- [ ] M Swagger at `/api/docs` on the deployed backend, every endpoint documented

### Testing

- [ ] M Unit (Jest), integration (Jest + Supertest on a real DB), component (Vitest + Testing Library), E2E (Playwright)
- [ ] M Tenancy isolation (doctor cannot read another hospital's patient)
- [ ] M Patient cannot read another patient's records
- [ ] M Simultaneous booking: only one succeeds
- [ ] M Refresh token unusable after rotation
- [ ] M Expired medicine cannot be dispensed
- [ ] M Invoice total equals sum of line items
- [ ] M E2E journeys: registration, book appointment, pay invoice, download report
- [ ] M Coverage > 70% with HTML report

### Deployment and CI/CD

- [ ] M Docker Compose production config; Nginx; SSL
- [ ] M Backend on AWS EC2, frontend on Vercel, managed PostgreSQL
- [ ] M GitHub Actions: PR lint + type-check + unit tests; main build, ECR push, integration tests; tag deploy with health-check gate (blue-green)
- [ ] M Branch protection; daily meaningful commits

### Deliverables

- [ ] M GitHub repository · README with setup, architecture, API base URL, demo credentials
- [ ] M Architecture diagram · ER diagram · Swagger UI live
- [ ] M Live demo URL with seeded data · one demo login per role
- [ ] M Project report (6–10 pages: decisions, challenges, lessons)
- [ ] M Jest coverage report · 5–8 minute video walkthrough

### Out of scope (must not be built)

- [ ] Video consultation · DICOM viewer · AI diagnostics or ML · native mobile apps · HL7/FHIR
