# MedCore HMS — Security

Status legend: **Required** (by PRD or decision) · **Implemented** (code exists) · **Tested** (automated test
passes; environment stated) · **Planned**. No regulatory compliance or certification is claimed. The PRD's
"HIPAA-aware" wording means HIPAA-inspired controls only. Last updated 2026-11-16.

## Control status

| Control | Requirement | Implemented | Tested | Notes |
| --- | --- | --- | --- | --- |
| Password hashing | SEC-001, AUTH-011: bcrypt cost ≥ 12 | **Yes**: bcrypt cost 12 (`bcryptjs`, DEC-026); dummy-hash comparison for unknown emails | **Yes** (VM T-AUTH-002) | |
| Password policy | DEC-012 | **Yes**: DTO + shared `checkPassword` (register, reset, CLI) | **Yes** (VM T-AUTH-002/007/011) | 10–128 chars, letter + number, ≠ email |
| JWT secrets | SEC-003: ≥ 256-bit, env only | **Yes**: startup rejects < 32 chars, placeholders, equal secrets | **Yes** (VM unit tests T-ENV-*) | Local `.env` has random 64-hex secrets |
| Access/refresh tokens, rotation, reuse detection | AUTH-002/003/010, SEC-004 | **Yes**: HS256, separate secrets, `typ` claim; Redis `rt:{userId}:{sessionId}` with atomic Lua compare-and-set; reuse revokes all sessions | **Yes** (VM T-AUTH-001/006/012) | Access token also requires a live session, so revocation is immediate |
| Email and phone verification | AUTH-006/007, DEC-011 | **Yes**: 6-digit OTP, HMAC stored in Redis, 10 min TTL, 5 attempts, 60 s resend cooldown; never logged or returned | **Yes** (VM T-AUTH-003/004) | Email via Mailpit locally; SMS via dev inbox locally |
| Logout one device / all | AUTH-008/010 | **Yes** | **Yes** (VM T-AUTH-006) | |
| RBAC (9 roles) | ROLE-010/011, SCOPE-004 | **Yes**: global `@Roles()` guard; permissions per role in `@medcore/types`; matrix in `docs/permissions-matrix.csv` | **Yes** (VM T-RBAC-000/001: 172 matrix cases) | Matrix grows with every new route (test fails on an unlisted route) |
| Role ↔ profile consistency | DEC-017 | In `constraints.sql` (not migrated) | — | Deferred trigger, all nine roles |
| Tenant isolation (database) | TEN-002/003, DEC-018 | In schema (not migrated) | **Yes** structure guard (VM: T-DB-001..004) | 85 composite FKs + 3 SQL FKs |
| Tenant isolation (requests) | TEN-003, TEST-010, TEST-016 | **Yes**: `hospitalId` from token only; `TenantGuard` 404s URLs naming another hospital; `TenantPrismaService` query extension scopes every operation on 41 models | **Yes** (VM T-TEN-001..003); PostgreSQL T-TEN-INT-001 not run | Feature code must use `TenantPrismaService`, never `PrismaService`, for tenant data (RULES) |
| Super Admin cross-tenant access | TEN-004 | **Yes**: unscoped client only for SUPER_ADMIN; every such request audited (`super_admin.read` or write with `crossTenant: true`) | **Yes** (VM T-TEN-002/003) | |
| CSRF | SEC-010 | **Yes**: SameSite=Strict + double-submit token on every POST/PUT/PATCH/DELETE; rotated at login/refresh | **Yes** (VM T-AUTH-010) | |
| Secure cookies | AUTH-002, SEC-010 | **Yes**: refresh cookie httpOnly, SameSite=Strict, Path=/api/auth, Secure in production | **Yes** (VM T-AUTH-005) | |
| CORS | SEC-006 | **Yes** (allow-list from env, credentials) | **Yes** (VM T-API-008) | Same-origin proxy (DEC-004) |
| Security headers | SEC-007 | **Yes** (Helmet; CSP relaxed only on `/api/docs`; `x-powered-by` off) | **Yes** (VM T-API-007) | |
| Rate limiting | SEC-005, CACHE-003 | **Yes**: global 1000/min and auth 100/15 min per IP, Redis-backed | **Yes** (VM unit T-AUTH-009; macOS T-INT-002) | |
| Input validation | SEC-011 | **Yes** backend (whitelist, forbid unknown, field errors); Zod web forms planned | **Yes** (VM T-API-004, T-VAL-*) | |
| SQL injection | SEC-008 | **Yes**: Prisma only; one tagged-template health probe | Structural | pgcrypto helpers approved (DEC-024) |
| XSS | SEC-009 | Planned (DOMPurify where user HTML renders) | — | React escapes by default |
| Error handling | API-003 | **Yes**: 5xx never leak internals | **Yes** (VM T-API-006, T-ERR-*) | |
| Log sanitisation | AUTH-012 | **Yes** (`AppLogger` + `sanitize`; keys: password, token, secret, otp, authorization, cookie, api key, cvv, card number, csrf, jwt, credential, private key, hash) | **Yes** (VM T-LOG-*) | |
| Audit logging | SEC-012, DB-013 | **Yes**: auth events from the auth service; `AuditInterceptor` for every successful write: actor, hospital, IP, user agent, route, **names** of submitted fields only (values only for fields a route declares safe, e.g. `isActive`); every entry passes `safeChanges` (secret keys redacted, raw bodies dropped, size bounded); append-only trigger in schema | **Yes** (VM T-AUD-001/002, in-memory) | No passwords, tokens, OTPs, personal or clinical values are stored (DEC-030) |
| Encryption at rest | SEC-014, EMR-012 | `*Enc` bytea columns + pgcrypto extension in schema; helpers planned (Phase 4) | — | Key from env, rotation script planned |
| Encryption in transit | SEC-002 | Planned (Nginx TLS, Phase 14) | — | Local dev is HTTP on localhost |
| File uploads | SEC-013, EMR-010 | **Partly**: doctor signatures validated by magic bytes + declared type + 512 KB, generated storage keys; clinical attachments in Phase 4; 20 MB CHECK in schema | **Yes** signatures (VM T-ORG) | Executables rejected by content check |
| Clinical immutability | EMR-002, DEC-016 | Triggers in `constraints.sql` (not migrated) | — | Originals never changed; who/when/why recorded |
| Booking integrity and privacy | APPT-002/006, TEST-011/012 | **Yes**: doctor row lock + exclusion constraints; patients and doctors list and read only their own appointments (other ids answer 404); reminder texts contain no clinical detail and SMS goes only to verified phones | **Yes** in memory (VM T-APPT-HTTP, T-RBAC-001c); real DB T-APPT-INT-001 pending | |
| Secrets | DEP-002 | **Yes**: `.env` git-ignored, `.env.example` placeholders, CI throwaway values only | Manual check | |
| Local infrastructure exposure | — | **Yes**: Docker ports bound to 127.0.0.1 | Manual | |
| Monitoring | SEC-015 | **Partly**: Sentry initialised when `SENTRY_DSN` set; 5xx captured | — | No DSN configured yet |
| Dependency supply chain | — | pnpm 11 build-script allow-list (`allowBuilds`), telemetry package denied | — | `pnpm audit` in CI planned |
| Backup and recovery | — | Planned (managed PostgreSQL backups, Phase 14) | — | |

## Outstanding risks

| ID | Risk | Mitigation / status |
| --- | --- | --- |
| R-01 | Constraints and triggers applied on PostgreSQL (owner, 2026-11-16) but not yet exercised by tests | `pnpm test:int` (T-MIG-001..006) |
| R-02 | Request-level tenant isolation verified only in memory; CI has never run | T-TEN-INT-001 on macOS after the migration; CI after an approved push |
| R-03 | Agent Teams through OpenRouter: provider and model behaviour unverified; credentials live in the owner's shell profile | Resolve the local `401 User not found`; never place keys in the repository |
| R-04 | Encryption key management for pgcrypto not yet designed in detail | Phase 4: env key, rotation script, documented |
| R-05 | Twilio trial and Indian SMS (DLT) restrictions for real SMS | Local SMS inbox in development (DEC-011); document limits |
| R-06 | ESLint 9 is marked deprecated upstream | Revisit after Phase 1; no security impact today |
| R-08 | Account enumeration: register returns 409 EMAIL_IN_USE (standard sign-up behaviour); login, resend and forgot-password answer generically | Auth rate limit; accepted trade-off, revisit if required |
| R-09 | Auth flows verified only against in-memory Prisma/Redis so far | T-AUTH-INT-001 on macOS after the migration |
| R-10 | Prisma drops undeclared keys: drift check found the 4 SQL-only same-tenant keys (now declared, DEC-031); CHECKs, exclusions and triggers remain outside Prisma | `sql-drift.spec.ts`; every migration `--create-only` + review; `prisma:drift` after each migration |
| R-07 | CI workflow has never run on GitHub (nothing pushed) | Push only with owner approval; then verify CI |
