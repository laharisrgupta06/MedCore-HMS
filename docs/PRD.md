# MedCore HMS — Product Requirements Document (with requirement IDs)

| Item | Value |
| --- | --- |
| Source | Original PRD, "MedCore HMS — Hospital Management Platform, Version 1.0, Solo Developer Project Brief" |
| Original files | [`docs/prd/MedCore-HMS-PRD-v1.0.docx`](prd/MedCore-HMS-PRD-v1.0.docx) (authoritative), [`docs/prd/MedCore-HMS-PRD-v1.0.txt`](prd/MedCore-HMS-PRD-v1.0.txt) (text conversion) |
| This file | The original requirements, wording preserved, each given a unique ID for traceability to [TASKS.md](TASKS.md) and [TEST_PLAN.md](TEST_PLAN.md) |
| Precedence | The original `.docx` wins over this file if they ever differ. Approved clarifications are listed separately in section 17 and never change the original text |
| Last updated | 2026-11-16 |

ID prefixes: SCOPE, TEN (tenancy), CACHE, TECH, DB, ROLE, AUTH, APPT, EMR, RX (prescriptions), LAB, PHARM,
BILL, NOTIF, API, FE (frontend), DASH (dashboards/analytics/search), SEC, TEST, DEP (deployment), DEL
(deliverables), EVAL, OUT (out of scope). Original PRD section numbers are given in each heading.

---

## 1. Product overview (PRD 01)

**Project overview.** MedCore HMS is a full-stack, cloud-native Hospital Management Platform designed to
digitise end-to-end clinical and administrative workflows across multiple hospital branches. Most mid-sized
hospitals in India and South-East Asia still rely on fragmented desktop software, paper registers and
WhatsApp groups to coordinate patient care. The project is a production-grade SaaS product that could
realistically be licensed to hospital chains, diagnostic centres and tele-health providers.

**Problem statement.** A large teaching hospital processes roughly 600–900 outpatient encounters per day.
The admission desk uses one legacy software for patient registration, the pharmacy uses a separate billing
tool, and lab technicians print results and physically deliver them to wards. A doctor finishing rounds
cannot check a patient's latest haemoglobin count without walking to the lab or waiting for a phone call.
The outcome is delayed clinical decisions, duplicate diagnostic tests, billing errors and poor patient
experience. MedCore HMS eliminates these friction points through a unified, role-aware, real-time platform.

**Product vision.** Build a scalable, HIPAA-aware Hospital Management System that serves hospitals ranging
from 30-bed clinics to 800-bed multi-speciality centres, all from a single multi-tenant SaaS deployment.

**Goals and objectives** (derived from the overview and the coordinator's note): one platform for
registration, scheduling, records, lab, pharmacy and billing; role-aware access; real-time information;
multi-hospital tenancy; and, per the coordinator, depth over breadth: "A fully working Auth + Appointments +
EMR + Billing flow — with proper validation, error handling, and tests — is far more impressive than ten
half-built modules."

**Target users.** Hospital chains, diagnostic centres and tele-health providers; inside a hospital, the
nine roles in section 6.

**Project constraints.** Individual project, advanced difficulty, 1 person, 4 weeks.

## 2. Scope by week (PRD 02)

| ID | Week | Requirement |
| --- | --- | --- |
| SCOPE-001 | 1 | Project scaffold: monorepo structure, Docker Compose, environment config |
| SCOPE-002 | 1 | PostgreSQL schema design with Prisma — all core models and migrations |
| SCOPE-003 | 1 | Authentication: JWT + Refresh Tokens, email OTP verification |
| SCOPE-004 | 1 | Role-Based Access Control — guard middleware for all 9 roles |
| SCOPE-005 | 1 | Hospital onboarding flow — Super Admin can create and verify a hospital |
| SCOPE-006 | 1 | Department and doctor profile setup |
| SCOPE-007 | 2 | Doctor availability calendar — weekly schedule with configurable time slots |
| SCOPE-008 | 2 | Appointment booking engine with conflict detection |
| SCOPE-009 | 2 | Appointment status lifecycle: PENDING → CONFIRMED → IN_PROGRESS → COMPLETED |
| SCOPE-010 | 2 | Electronic Medical Record creation during an appointment encounter |
| SCOPE-011 | 2 | Vitals, diagnosis, treatment plan, allergy and medication history |
| SCOPE-012 | 2 | Prescription module — medicine search, dosage, frequency, PDF export |
| SCOPE-013 | 3 | Laboratory: doctor creates test orders, lab tech uploads results, approval workflow |
| SCOPE-014 | 3 | Pharmacy: medicine inventory, expiry tracking, prescription fulfilment |
| SCOPE-015 | 3 | Billing: invoice generation, line items from all departments, Stripe / Razorpay integration |
| SCOPE-016 | 3 | Real-time notifications: in-app (Socket.IO), email (Resend), SMS (Twilio) |
| SCOPE-017 | 3 | Patient portal: view records, download reports, track invoices, make payments |
| SCOPE-018 | 4 | Role-specific dashboards with charts (Recharts) — revenue, appointments, patient growth |
| SCOPE-019 | 4 | Global search with filters and pagination across patients, doctors, medicines |
| SCOPE-020 | 4 | Unit tests for core services, integration tests for critical API paths |
| SCOPE-021 | 4 | Docker Compose production configuration, Nginx reverse proxy, SSL setup |
| SCOPE-022 | 4 | Deploy backend to AWS EC2, frontend to Vercel, database to managed PostgreSQL |
| SCOPE-023 | 4 | Seed demo data, write README, generate Swagger API docs |

PRD hints recorded as guidance (not requirements): design the ER diagram and Prisma schema in the first two
days; start with auth and RBAC; on Week 3 Day 1 wire the invoice model first and do not leave payment
webhooks to the last day.

### Out of scope (PRD 02)

| ID | Excluded |
| --- | --- |
| OUT-001 | Video consultation (WebRTC / Daily.co) |
| OUT-002 | DICOM image rendering (complex radiology viewer) |
| OUT-003 | AI-assisted diagnostics or ML predictions |
| OUT-004 | Mobile native apps (iOS / Android) |
| OUT-005 | HL7 / FHIR interoperability connectors |

Project-owner addition (DEC-002): no AI or LLM APIs, SDKs or AI-dependent functionality anywhere in the application.

## 3. System architecture (PRD 03)

| ID | Requirement |
| --- | --- |
| TECH-001 | Clean, layered architecture separating presentation, business logic and data access |
| TECH-002 | The backend exposes a RESTful API consumed by the Next.js frontend and, eventually, mobile clients |
| TECH-003 | Components: Browser/PWA ↔ Next.js 15 frontend; HTTPS/REST + WebSocket; Nginx reverse proxy ↔ NestJS API (port 3001); Prisma ORM; PostgreSQL, Redis cache, AWS S3 / Cloudinary; Socket.IO server as real-time event bus |
| TEN-001 | Each hospital operates as a tenant |
| TEN-002 | All database tables that hold hospital-specific data carry a `hospitalId` foreign key |
| TEN-003 | Middleware validates this on every request so that no tenant can ever access another tenant's data — even if they guess a record ID |
| TEN-004 | Super Admins operate across tenants; all other roles are scoped to a single hospital at authentication time |
| TEN-005 | Justify the chosen tenancy approach (database-, schema- or row-per-tenant) in the report |
| CACHE-001 | Redis for session storage of refresh tokens and device tracking |
| CACHE-002 | Redis short-lived caches for expensive reads (doctor availability slots, medicine inventory counts); availability TTL 60 seconds |
| CACHE-003 | Redis rate-limiting counters to protect public endpoints |

## 4. Technology stack (PRD 04)

| ID | Layer | Technology and purpose |
| --- | --- | --- |
| TECH-010 | Frontend | Next.js 15 (App Router): SSR, RSC, file-based routing |
| TECH-011 | Frontend | React 19 |
| TECH-012 | All | TypeScript, strict typing; shared types between frontend and backend via a types package |
| TECH-013 | Frontend | Tailwind CSS: utility-first styling, no custom CSS files |
| TECH-014 | Frontend | Shadcn UI on Radix UI |
| TECH-015 | Frontend | Framer Motion: micro-animations and page transitions |
| TECH-016 | Frontend | React Hook Form + Zod |
| TECH-017 | Frontend | TanStack Query |
| TECH-018 | Frontend | Zustand (auth, theme, sidebar) |
| TECH-020 | Backend | NestJS: modules, guards, interceptors |
| TECH-021 | Backend | Prisma ORM |
| TECH-022 | Backend | PostgreSQL 16 |
| TECH-023 | Backend | Redis 7: caching, sessions, rate limiting |
| TECH-024 | Backend | Socket.IO: notifications, chat |
| TECH-025 | Backend | Passport.js: JWT, Google OAuth |
| TECH-026 | Backend | Bull / BullMQ: email, PDF generation, reports |
| TECH-027 | Backend | Multer + Sharp: uploads and image optimisation |
| TECH-030 | Infra | Docker + Docker Compose: identical dev and prod environments |
| TECH-031 | Infra | Nginx: reverse proxy, SSL termination, rate limiting at edge |
| TECH-032 | Infra | GitHub Actions: lint, test, build, deploy on every push to main |
| TECH-033 | Infra | AWS (EC2 / RDS / S3) |
| TECH-034 | Infra | Vercel: frontend deployment |
| TECH-035 | Infra | Sentry: error tracking and performance monitoring |
| TECH-040 | Tools | Node.js 20 LTS, pnpm 9, PostgreSQL 16, Redis 7, Docker Desktop, Git 2.40+, VS Code (see DEC-005: Node 24 and pnpm 11 approved) |

## 5. Database design (PRD 05)

| ID | Requirement |
| --- | --- |
| DB-001 | Prisma schema normalised to 3NF, with the complete field list for every model |
| DB-002 | Hospital → User, Department, Room: one hospital, many |
| DB-003 | User → Role, Hospital: many users, one hospital |
| DB-004 | Doctor → User, Department, Appointment: one-to-one with User |
| DB-005 | Patient → User, Hospital: one-to-one with User |
| DB-006 | Appointment → Doctor, Patient, Department: many-to-one each |
| DB-007 | MedicalRecord → Appointment, Patient, Doctor: one appointment, one record |
| DB-008 | Prescription → MedicalRecord, Medicine: many-to-many via PrescriptionItem |
| DB-009 | LabOrder → MedicalRecord, LabTest: one record, many orders |
| DB-010 | Invoice → Appointment, Patient: one appointment, one invoice |
| DB-011 | InvoiceItem → Invoice, (Lab/Pharmacy/Consult): many-to-one invoice |
| DB-012 | Notification → User, (linked entity): polymorphic recipient |
| DB-013 | AuditLog → User, any entity: all write operations logged |
| DB-014 | Soft deletes on Patient, Doctor and Appointment via `deletedAt`; medical records are never permanently deleted |
| DB-015 | Separate reusable Address model for hospitals, patients and suppliers |
| DB-016 | Decide doctor availability storage (weekly schedule vs individual slots) |
| DB-017 | Decide the prescription–medicine many-to-many with per-item dosage, frequency, duration |
| DB-018 | Decide lab result storage (key-value, file, or hybrid) |
| DB-019 | Indexes at minimum on hospitalId, patientId, doctorId, appointmentDate and columns used in WHERE clauses; tune with EXPLAIN ANALYZE |
| DB-020 | Migrations managed with Prisma |

## 6. Roles and permissions (PRD 06)

| ID | Role | Primary responsibilities |
| --- | --- | --- |
| ROLE-001 | Super Admin | Platform-wide management, hospital onboarding, subscription billing, global analytics |
| ROLE-002 | Hospital Admin | Configure hospital: departments, staff, beds, hospital-level analytics, billing config |
| ROLE-003 | Doctor | Patient encounters, EMR, prescriptions, lab/radiology orders, availability calendar |
| ROLE-004 | Nurse | Vitals recording, medication administration notes, ward management |
| ROLE-005 | Receptionist | Patient registration, appointment scheduling, invoice generation |
| ROLE-006 | Lab Technician | Receive test orders, upload results, approve reports |
| ROLE-007 | Pharmacist | Verify prescriptions, dispense medicines, manage inventory |
| ROLE-008 | Accountant | Financial reports, insurance claims, payment reconciliation |
| ROLE-009 | Patient | View own records, book appointments, download reports, manage payments |
| ROLE-010 | RBAC implemented as a NestJS Guard with a custom `@Roles()` decorator |
| ROLE-011 | A permissions matrix (every endpoint × all 9 roles) used as the test specification |

## 7. Module specifications (PRD 07)

### 7.1 Authentication

| ID | Requirement |
| --- | --- |
| AUTH-001 | `POST /auth/register` — create account with email verification |
| AUTH-002 | `POST /auth/login` — issue access token (15 min TTL) + refresh token (7 days, stored in httpOnly cookie) |
| AUTH-003 | `POST /auth/refresh` — exchange refresh token for new access token |
| AUTH-004 | `POST /auth/forgot-password` — send reset link via email |
| AUTH-005 | `POST /auth/reset-password` — validate token, update hashed password |
| AUTH-006 | `POST /auth/verify-email` — confirm email via 6-digit OTP |
| AUTH-007 | `POST /auth/verify-phone` — confirm phone via SMS OTP (Twilio) |
| AUTH-008 | `POST /auth/logout` — revoke refresh token in Redis |
| AUTH-009 | `GET /auth/me` — return current user profile with permissions |
| AUTH-010 | Refresh tokens stored in Redis as `rt:{userId}:{deviceId}`, enabling single-device and all-device logout |
| AUTH-011 | Passwords hashed with bcrypt at cost factor 12 |
| AUTH-012 | Never log passwords, tokens or OTPs; a log sanitiser strips them from all output |

### 7.2 Appointments

| ID | Requirement |
| --- | --- |
| APPT-001 | A doctor works in one or more departments and defines time slots (e.g. 9:00–13:00, 30-minute intervals) |
| APPT-002 | A patient cannot have two appointments at the same time across any doctor |
| APPT-003 | States: PENDING → CONFIRMED → IN_PROGRESS → COMPLETED \| CANCELLED \| NO_SHOW |
| APPT-004 | Emergency bookings bypass normal slot availability and flag the appointment as EMERGENCY |
| APPT-005 | Reminders 24 hours and 1 hour before, via email + SMS (BullMQ scheduled jobs) |
| APPT-006 | No doctor is double-booked; of two simultaneous bookings for one slot only one succeeds, using database locking (SELECT FOR UPDATE) or optimistic concurrency, with the reasoning documented |

### 7.3 Electronic medical records

| ID | Requirement |
| --- | --- |
| EMR-001 | A medical record is created when a doctor starts an appointment encounter |
| EMR-002 | Records are append-only: doctors can add notes but cannot delete past entries |
| EMR-003 | Vitals: BP, pulse, temperature, SpO2, height, weight, BMI (auto-calculated) |
| EMR-004 | Chief complaint and presenting symptoms |
| EMR-005 | Differential and confirmed diagnosis (mapped to ICD-10 codes where possible) |
| EMR-006 | Treatment plan with instructions |
| EMR-007 | Allergies and adverse drug reactions |
| EMR-008 | Vaccination history (date, vaccine name, batch number, next due date) |
| EMR-009 | Family history flags (diabetes, hypertension, cancer, cardiac) |
| EMR-010 | Attached files: scanned documents and images, stored in S3, max 20 MB per file |
| EMR-011 | Medication history (from scope item SCOPE-011) |
| EMR-012 | Medical records encrypted at rest and in transit (PRD hint; see SEC-014) |

### 7.4 Prescriptions

| ID | Requirement |
| --- | --- |
| RX-001 | Issued at the end of an encounter, linked to a medical record |
| RX-002 | Printable or downloadable as a signed PDF |
| RX-003 | Medicine name searchable from the pharmacy inventory |
| RX-004 | Form: tablet / capsule / syrup / injection / topical |
| RX-005 | Dosage (e.g. 500 mg), frequency (OD / BD / TDS / QID / SOS), duration (days) |
| RX-006 | Special instructions (take after food, avoid sunlight, etc.) |
| RX-007 | Doctor's digital signature (SVG or PNG) overlaid on the PDF |
| RX-008 | PDF generated from an HTML template (Puppeteer suggested) with hospital letterhead |

### 7.5 Laboratory

| ID | Requirement |
| --- | --- |
| LAB-001 | Doctor creates a LabOrder (linked to MedicalRecord) with one or more tests |
| LAB-002 | Receptionist or Lab Tech receives the order; status changes to SAMPLE_COLLECTED |
| LAB-003 | Lab Tech processes the sample and uploads a structured result or PDF report |
| LAB-004 | Senior Lab Tech or Lab Manager reviews and approves the report |
| LAB-005 | Patient and doctor are notified; the report becomes visible in both portals |
| LAB-006 | Reference ranges stored so out-of-range values are flagged automatically (red on the report) |
| LAB-007 | Doctors can place radiology orders (from ROLE-003) |

### 7.6 Pharmacy

| ID | Requirement |
| --- | --- |
| PHARM-001 | Each medicine batch has batch number, manufacturing date, expiry date, quantity, unit cost, MRP |
| PHARM-002 | FIFO dispensing: oldest batch consumed first |
| PHARM-003 | Low-stock alert when quantity falls below the reorder level (configurable per medicine) |
| PHARM-004 | Expired stock is flagged and quarantined; it cannot be dispensed |
| PHARM-005 | Nightly BullMQ job reports medicines expiring within 30 days to the Pharmacist and Hospital Admin |
| PHARM-006 | Verify prescriptions and fulfil them (from ROLE-007) |

### 7.7 Billing and payments

| ID | Requirement |
| --- | --- |
| BILL-001 | Charges from all departments (consultation fee, lab tests, medicines, room charges) aggregated into a single invoice per visit |
| BILL-002 | Items are added to a draft invoice as services are rendered |
| BILL-003 | Receptionist or Accountant finalises the invoice and shares it with the patient |
| BILL-004 | Patient pays by Stripe card, Razorpay UPI/Netbanking, or cash at the counter |
| BILL-005 | Payment confirmation triggers a receipt email and sets the invoice status to PAID |
| BILL-006 | Insurance claims follow a separate TPA (Third Party Administrator) workflow |
| BILL-007 | Never trust client-side payment confirmation; verify via provider webhooks with signature comparison; include a simulated webhook test |
| BILL-008 | Hospital billing configuration (from ROLE-002) and payment reconciliation (from ROLE-008) |

### 7.8 Notifications

| ID | Trigger | Channels |
| --- | --- | --- |
| NOTIF-001 | All notifications are backend events; a worker subscribes and dispatches per channel | — |
| NOTIF-002 | Appointment confirmed | Email + SMS + In-app |
| NOTIF-003 | Appointment reminder (24h) | Email + SMS |
| NOTIF-004 | Lab report approved | Email + In-app push |
| NOTIF-005 | Prescription ready at pharmacy | SMS + In-app |
| NOTIF-006 | Invoice generated | Email + In-app |
| NOTIF-007 | Payment received | Email + SMS |
| NOTIF-008 | Low stock alert (staff only) | Email + In-app |
| NOTIF-009 | Emergency appointment created | In-app + SMS (doctor) |
| NOTIF-010 | Fan-out: one event, separate handlers, each in its own BullMQ queue so a failed SMS does not block email | — |

## 8. API contract (PRD 08)

| ID | Requirement |
| --- | --- |
| API-001 | RESTful conventions with consistent response envelopes and error shapes |
| API-002 | Success: `{ "success": true, "data": { ... }, "message": "OK" }` |
| API-003 | Error: `{ "success": false, "error": { "code": "SLOT_UNAVAILABLE", "message": "This slot was just booked by another patient." } }` |
| API-004 | Paginated list: `{ "success": true, "data": [...], "meta": { "page": 1, "limit": 20, "total": 348, "totalPages": 18 } }` |
| API-005 | Shared TypeScript types package exporting API request/response interfaces, used by frontend and backend |
| API-006 | Every endpoint documented with Swagger (`@nestjs/swagger`) |

Core endpoints (PRD 08 table):

| ID | Module | Method + path | Auth |
| --- | --- | --- | --- |
| API-010 | Auth | `POST /auth/login` | Public |
| API-011 | Auth | `POST /auth/refresh` | Refresh token |
| API-012 | Users | `GET /users/:id` | Self or Admin |
| API-013 | Hospitals | `GET /hospitals` | Super Admin |
| API-014 | Departments | `GET /hospitals/:id/departments` | Hospital staff |
| API-015 | Doctors | `GET /doctors?hospitalId=&specialisation=` | Any authenticated |
| API-016 | Appointments | `POST /appointments` | Patient / Receptionist |
| API-017 | Appointments | `PATCH /appointments/:id/status` | Doctor / Receptionist |
| API-018 | EMR | `POST /medical-records` | Doctor |
| API-019 | EMR | `GET /medical-records/:patientId` | Doctor / Nurse / Patient (own) |
| API-020 | Prescriptions | `POST /prescriptions` | Doctor |
| API-021 | Prescriptions | `GET /prescriptions/:id/pdf` | Doctor / Patient (own) |
| API-022 | Lab Orders | `POST /lab-orders` | Doctor |
| API-023 | Lab Results | `PATCH /lab-orders/:id/result` | Lab Technician |
| API-024 | Medicines | `GET /medicines?search=&hospitalId=` | Pharmacist / Doctor |
| API-025 | Invoices | `POST /invoices` | Receptionist / Accountant |
| API-026 | Payments | `POST /payments/webhook/stripe` | Stripe (signature verified) |
| API-027 | Analytics | `GET /analytics/revenue?from=&to=` | Admin / Accountant |
| API-028 | Notifications | `GET /notifications/me` | Any authenticated |

The full endpoint plan beyond this core set is in [implementation-roadmap.md §7](implementation-roadmap.md).

## 9. Frontend (PRD 09)

| ID | Requirement |
| --- | --- |
| FE-001 | Must feel like a professional clinical tool: clean, information-dense, fast (reference Practo, Epic Hyperspace) |
| FE-002 | Folders: `app/(auth)` (login, register, forgot-password, MFA), `app/(dashboard)` (role-aware), `app/(portal)` (patient), `components/ui` (Shadcn, unmodified), `components/shared`, `components/modules`, `hooks`, `services`, `store`, `types`, `lib`, `constants` |
| FE-003 | Server components for data-heavy pages; client components for interactive widgets |
| FE-004 | Small, focused Zustand stores (auth, notifications, UI preferences) |
| FE-005 | Recharts for all charts, in client components |
| DASH-001 | Doctor dashboard: today's appointments timeline (sorted, colour-coded by status) |
| DASH-002 | Doctor dashboard: quick-access patient lookup search bar |
| DASH-003 | Doctor dashboard: pending lab result approvals widget |
| DASH-004 | Doctor dashboard: upcoming follow-ups calendar (mini month view) |
| DASH-005 | Doctor dashboard: recent prescriptions panel |
| DASH-006 | Hospital Admin: KPI cards — total patients today, revenue today, occupied beds, active doctors |
| DASH-007 | Hospital Admin: appointment volume bar chart (last 7 days) |
| DASH-008 | Hospital Admin: department occupancy heat map |
| DASH-009 | Hospital Admin: low-stock pharmacy alerts panel |
| DASH-010 | Hospital Admin: recent activity log |
| DASH-011 | Role-specific dashboards with charts: revenue, appointments, patient growth (SCOPE-018) |
| DASH-012 | Global search with filters and pagination across patients, doctors, medicines (SCOPE-019) |
| DASH-013 | Super Admin global analytics (ROLE-001); Accountant financial reports (ROLE-008) |
| FE-010 | Patient portal: view records, download reports, track invoices, make payments, book appointments (SCOPE-017, ROLE-009) |

Additional frontend quality requirements approved by the project owner (Part 11 specification) are
preserved verbatim in [frontend-design-system.md](frontend-design-system.md) and governed by
[DESIGN.md](DESIGN.md). They add visual and quality requirements without changing functional scope.

## 10. Security (PRD 10)

| ID | Control | Requirement |
| --- | --- | --- |
| SEC-001 | Password hashing | bcrypt with minimum cost factor 12 |
| SEC-002 | Transport | HTTPS everywhere; HTTP redirects to HTTPS at Nginx |
| SEC-003 | JWT secrets | Minimum 256-bit random secret, in environment variables only |
| SEC-004 | Refresh token rotation | New refresh token on every use; the old one invalidated |
| SEC-005 | Rate limiting | 100 req / 15 min per IP on auth endpoints; 1000 req/min on API |
| SEC-006 | CORS | Strict allow-list: only the frontend domain(s) |
| SEC-007 | Helmet.js | All recommended HTTP security headers |
| SEC-008 | SQL injection | Prisma parameterised queries; never use raw() |
| SEC-009 | XSS | Sanitise user-supplied HTML with DOMPurify (frontend) |
| SEC-010 | CSRF | SameSite=Strict cookies; CSRF token on state-changing requests |
| SEC-011 | Input validation | Zod on the frontend; class-validator + class-transformer on NestJS DTOs |
| SEC-012 | Audit logging | Every create/update/delete logged with userId, IP, timestamp |
| SEC-013 | File upload | Validate MIME type + extension; scan with ClamAV or reject executables |
| SEC-014 | Data encryption | Sensitive columns (diagnosis, notes) encrypted at rest using pgcrypto |
| SEC-015 | Monitoring | Sentry from day one |

## 11. Testing (PRD 11)

| ID | Requirement |
| --- | --- |
| TEST-001 | Unit tests (Jest): pure functions, services, Zod schemas, helpers — 80%+ coverage |
| TEST-002 | Integration tests (Jest + Supertest): API endpoints against a real test database, all happy and error paths |
| TEST-003 | Component tests (Vitest + Testing Library): form validation, conditional rendering |
| TEST-004 | E2E (Playwright): registration, book appointment, pay invoice, download report |
| TEST-010 | A doctor cannot access another hospital's patient records |
| TEST-011 | A patient cannot view another patient's medical records |
| TEST-012 | Two simultaneous bookings of the same slot: only one succeeds |
| TEST-013 | A refresh token cannot be reused after rotation |
| TEST-014 | An expired medicine cannot be dispensed: pharmacy throws a validation error |
| TEST-015 | An invoice total equals the sum of its line items |
| TEST-016 | Tenancy isolation tests from day one, run in CI |

## 12. Deployment (PRD 12)

| ID | Requirement |
| --- | --- |
| DEP-001 | Docker Compose with postgres:16-alpine, redis:7-alpine, api, frontend, nginx (80/443) |
| DEP-002 | Never commit `.env`; `.env.example` documents every variable; `.env` git-ignored from the first commit |
| DEP-003 | CI on every pull request: lint (ESLint + Prettier), type-check (`tsc --noEmit`), unit tests |
| DEP-004 | On merge to main: build Docker images, push to ECR, integration tests against a staging DB |
| DEP-005 | On release tag: deploy to production (blue-green with health-check gate) |
| DEP-006 | Protected main branch: passing CI required, no direct pushes |

## 13. Deliverables (PRD 13)

| ID | Deliverable |
| --- | --- |
| DEL-001 | GitHub repository with daily commits and meaningful messages |
| DEL-002 | README: setup, architecture overview, API base URL, demo credentials |
| DEL-003 | Architecture diagram (Excalidraw / draw.io) |
| DEL-004 | ER diagram generated from Prisma |
| DEL-005 | Swagger UI at `/api/docs` on the deployed backend |
| DEL-006 | Live demo: frontend (Vercel) + backend (AWS EC2) with seeded data |
| DEL-007 | Demo credentials: one login per role |
| DEL-008 | Project report: technical decisions, challenges, lessons (6–10 pages) |
| DEL-009 | Jest coverage HTML report showing >70% coverage |
| DEL-010 | Video walkthrough, 5–8 minutes |
| DEL-011 | Seed: at least 2 hospitals, 8 doctors across specialisations, 30 patients, 2 weeks of appointment history |

## 14. Evaluation criteria (PRD 14)

| ID | Area | Weight | What is assessed |
| --- | --- | --- | --- |
| EVAL-001 | System architecture | 15% | Multi-tenancy, separation of concerns, module boundaries |
| EVAL-002 | Database design | 15% | Normalisation, relationships, indexes, migrations |
| EVAL-003 | Backend API quality | 20% | REST conventions, error handling, validation, auth and RBAC |
| EVAL-004 | Frontend UX | 15% | Responsiveness, loading and error states, accessibility |
| EVAL-005 | Security | 10% | All checklist items, no secrets in code, input validation |
| EVAL-006 | Testing | 10% | Coverage breadth, critical paths, CI integration |
| EVAL-007 | Deployment | 10% | Live demo, Docker Compose, CI/CD |
| EVAL-008 | Documentation | 5% | README, API docs, ER diagram, architecture diagram |

## 15. Integrations (PRD 04, 07, 15)

Stripe (test mode), Razorpay (test mode), Resend (email), Twilio (SMS), AWS S3 or Cloudinary (files),
Sentry (errors), AWS EC2/RDS, Vercel, Neon/Supabase (alternative managed PostgreSQL), Upstash (managed Redis).
Development uses local or mock providers (DEC-003).

## 16. Workflows (derived from the requirements above)

- **Patient:** register (AUTH-001, DEC-010) → verify email (AUTH-006) → book appointment (API-016) →
  view records, download reports, track and pay invoices (FE-010, BILL-004).
- **Receptionist:** register patients, schedule and confirm appointments, record sample collection, create invoices (ROLE-005, LAB-002, BILL-003).
- **Doctor:** manage availability (APPT-001) → start encounter (EMR-001) → record EMR data (EMR-003..011) → prescribe (RX-001..008) → order lab/radiology (LAB-001, LAB-007).
- **Nurse:** record vitals and medication administration notes; ward/bed status (ROLE-004).
- **Lab Technician:** receive order → collect sample → enter results → senior approves (LAB-001..006).
- **Pharmacist:** verify prescription → dispense FIFO → manage stock, expiry, alerts (PHARM-001..006).
- **Accountant:** finalise invoices, reconcile payments, process TPA claims, financial reports (BILL-003..008).
- **Hospital Admin:** departments, staff, beds, billing configuration, hospital analytics (ROLE-002).
- **Super Admin:** create and verify hospitals, subscription, global analytics (ROLE-001, SCOPE-005).

## 17. Approved clarifications (do not change the original text above)

Recorded in [DECISIONS.md](DECISIONS.md). Summary: Node 24 + pnpm 11 instead of the end-of-life Node 20 /
pnpm 9 (DEC-005); no AI APIs (DEC-002); mock/local providers in development (DEC-003); same-origin API
proxy (DEC-004); senior lab-tech flag, radiology as a lab category, nurse administration notes, minimal
subscription fields, one hospital per user (DEC-006); patient registration with a hospital code (DEC-010);
local OTP delivery (DEC-011); password policy (DEC-012); first Super Admin via CLI (DEC-013); Database
Engineer owns the schema (DEC-008); Privacy, Terms, 404 and SEO in scope, custom domain optional (DEC-009);
clinical corrections, PRD gap fixes and composite tenant keys (DEC-016 to DEC-018).
