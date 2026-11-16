# MedCore HMS — Security

Status legend: **Required** (by PRD or decision) · **Implemented** (code exists) · **Tested** (automated test
passes; environment stated) · **Planned**. No regulatory compliance or certification is claimed. The PRD's
"HIPAA-aware" wording means HIPAA-inspired controls only. Last updated 2026-11-16.

## Control status

| Control | Requirement | Implemented | Tested | Notes |
| --- | --- | --- | --- | --- |
| Password hashing | SEC-001, AUTH-011: bcrypt cost ≥ 12 | Planned (1B) | — | |
| Password policy | DEC-012 | Planned (1B) | — | 10–128 chars, letter + number, ≠ email |
| JWT secrets | SEC-003: ≥ 256-bit, env only | **Yes**: startup rejects < 32 chars, placeholders, equal secrets | **Yes** (VM unit tests T-ENV-*) | Local `.env` has random 64-hex secrets |
| Access/refresh tokens, rotation, reuse detection | AUTH-002/003/010, SEC-004 | Planned (1B) | — | Redis `rt:{userId}:{deviceId}` |
| Email and phone verification | AUTH-006/007, DEC-011 | Planned (1B) | — | OTP hashed in Redis, TTL, attempt limit, never logged |
| Logout one device / all | AUTH-008/010 | Planned (1B) | — | |
| RBAC (9 roles) | ROLE-010/011, SCOPE-004 | Planned (1C) | — | `@Roles()`, permissions matrix |
| Role ↔ profile consistency | DEC-017 | In `constraints.sql` (not migrated) | — | Deferred trigger, all nine roles |
| Tenant isolation (database) | TEN-002/003, DEC-018 | In schema (not migrated) | **Yes** structure guard (VM: T-DB-001..004) | 85 composite FKs + 3 SQL FKs |
| Tenant isolation (requests) | TEN-003, TEST-010, TEST-016 | Planned (1C) | — | `hospitalId` from token only; Prisma extension; 404 for other tenants |
| Super Admin cross-tenant access | TEN-004 | Planned (1C) | — | Separate audited client |
| CSRF | SEC-010 | Planned (1B) | — | SameSite=Strict + CSRF token |
| Secure cookies | AUTH-002, SEC-010 | `cookie-parser` installed; cookies planned (1B) | — | httpOnly, Secure in production, SameSite=Strict |
| CORS | SEC-006 | **Yes** (allow-list from env, credentials) | **Yes** (VM T-API-008) | Same-origin proxy (DEC-004) |
| Security headers | SEC-007 | **Yes** (Helmet; CSP relaxed only on `/api/docs`; `x-powered-by` off) | **Yes** (VM T-API-007) | |
| Rate limiting | SEC-005, CACHE-003 | **Partly**: global 1000/min, Redis-backed, atomic | **Yes** (VM unit; macOS integration T-INT-002) | Auth limit 100/15 min planned (1B) |
| Input validation | SEC-011 | **Yes** backend (whitelist, forbid unknown, field errors); Zod web forms planned | **Yes** (VM T-API-004, T-VAL-*) | |
| SQL injection | SEC-008 | **Yes**: Prisma only; one tagged-template health probe | Structural | pgcrypto helpers approved (DEC-024) |
| XSS | SEC-009 | Planned (DOMPurify where user HTML renders) | — | React escapes by default |
| Error handling | API-003 | **Yes**: 5xx never leak internals | **Yes** (VM T-API-006, T-ERR-*) | |
| Log sanitisation | AUTH-012 | **Yes** (`AppLogger` + `sanitize`) | **Yes** (VM T-LOG-*) | |
| Audit logging | SEC-012, DB-013 | Table + append-only trigger in schema; interceptor planned (1C) | — | |
| Encryption at rest | SEC-014, EMR-012 | `*Enc` bytea columns + pgcrypto extension in schema; helpers planned (Phase 4) | — | Key from env, rotation script planned |
| Encryption in transit | SEC-002 | Planned (Nginx TLS, Phase 14) | — | Local dev is HTTP on localhost |
| File uploads | SEC-013, EMR-010 | 20 MB CHECK in schema; validation planned (Phase 4) | — | MIME + extension + magic bytes; reject executables |
| Clinical immutability | EMR-002, DEC-016 | Triggers in `constraints.sql` (not migrated) | — | Originals never changed; who/when/why recorded |
| Secrets | DEP-002 | **Yes**: `.env` git-ignored, `.env.example` placeholders, CI throwaway values only | Manual check | |
| Local infrastructure exposure | — | **Yes**: Docker ports bound to 127.0.0.1 | Manual | |
| Monitoring | SEC-015 | **Partly**: Sentry initialised when `SENTRY_DSN` set; 5xx captured | — | No DSN configured yet |
| Dependency supply chain | — | pnpm 11 build-script allow-list (`allowBuilds`), telemetry package denied | — | `pnpm audit` in CI planned |
| Backup and recovery | — | Planned (managed PostgreSQL backups, Phase 14) | — | |

## Outstanding risks

| ID | Risk | Mitigation / status |
| --- | --- | --- |
| R-01 | Schema constraints and triggers have only been syntax-checked, not executed by PostgreSQL | Run migration on macOS (DEC-019/025) and add database integration tests |
| R-02 | Request-level tenant isolation not yet implemented | Phase 1C with mandatory isolation tests in CI |
| R-03 | Agent Teams through OpenRouter: provider and model behaviour unverified; credentials live in the owner's shell profile | Resolve the local `401 User not found`; never place keys in the repository |
| R-04 | Encryption key management for pgcrypto not yet designed in detail | Phase 4: env key, rotation script, documented |
| R-05 | Twilio trial and Indian SMS (DLT) restrictions for real SMS | Local SMS inbox in development (DEC-011); document limits |
| R-06 | ESLint 9 is marked deprecated upstream | Revisit after Phase 1; no security impact today |
| R-07 | CI workflow has never run on GitHub (nothing pushed) | Push only with owner approval; then verify CI |
