# MedCore HMS — Test Plan and Results

Environments: **VM** = Linux build VM (Node 22, no Docker, Prisma engines blocked) · **Mac** = project
owner's macOS (Node 24, Docker) · **CI** = GitHub Actions (not yet run: nothing pushed). A test is never
marked passed unless it was executed; the environment is always stated. Last updated 2026-11-16.

## 1. Strategy

| Layer | Tool | Scope | Command |
| --- | --- | --- | --- |
| Unit | Jest (API) | Services, filters, pipes, config, utilities, schema guards | `pnpm test` |
| Component | Vitest + Testing Library (web) | Components, API client, states | `pnpm test` |
| Integration / API | Jest + Supertest + real PostgreSQL/Redis | Endpoints, database behaviour, constraints | `pnpm test:int` (needs `pnpm infra:up`) |
| End-to-end | Playwright (desktop + mobile Chromium) | PRD journeys TEST-004 | `pnpm --filter @medcore/e2e test:e2e` (no specs yet) |
| Static | Prettier, ESLint, TypeScript, `prisma validate` | Whole monorepo | `pnpm format:check`, `pnpm lint`, `pnpm typecheck` |
| CI | GitHub Actions | All of the above with PostgreSQL + Redis services | on pull request |

Coverage targets: services ≥ 80% (TEST-001); overall > 70% for the deliverable report (DEL-009). Not yet measured.

Categories still to be built out per phase: authentication, authorisation matrix, tenant isolation,
security, performance (`EXPLAIN ANALYZE`, DB-019), responsive and accessibility checks (Part 11), regression
(full suite in CI on every pull request).

## 2. Executed tests

| Test ID | Req. | File / scenario | Expected | Actual | Status | Env | Date |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-ENV-001..006 | SEC-003, DEP-002 | `config/env.spec.ts`: valid config + defaults; short secret rejected without printing it; placeholder rejected; equal secrets rejected; missing/malformed URLs; empty CORS | Startup validation behaves as specified | 6/6 pass | Pass | VM | 2026-11-16 |
| T-LOG-001..003 | AUTH-012 | `logger/sanitize.spec.ts`: nested keys redacted; bearer tokens in strings; circular/primitive values | No secrets in logs | 3/3 pass | Pass | VM | 2026-11-16 |
| T-ENV-010..012 | API-002, API-004 | `http/paginated-result.spec.ts`: PRD example 348/20 → 18 pages; empty list; plain wrap | PRD envelopes | 3/3 pass | Pass | VM | 2026-11-16 |
| T-ERR-001..005 | API-003 | `filters/all-exceptions.filter.spec.ts`: module codes kept; default codes; validation details; no internal leak; malformed JSON → 400 | Error envelope | 5/5 pass | Pass | VM | 2026-11-16 |
| T-VAL-001..003 | SEC-011 | `pipes/validation.spec.ts`: dotted field errors; unknown properties rejected; valid DTO passes | Validation | 3/3 pass | Pass | VM | 2026-11-16 |
| T-RED-001..003 | CACHE-001 | `redis/redis-url.spec.ts`: parse host/port/db; credentials + TLS; bad scheme/db | Correct parsing | 3/3 pass | Pass | VM | 2026-11-16 |
| T-RL-001..002 | SEC-005, CACHE-003 | `throttler/redis-throttler.storage.spec.ts`: namespaced keys, ms→s; blocked caller | Correct throttler record | 2/2 pass | Pass | VM | 2026-11-16 |
| T-HLT-001..003 | SCOPE-001 | `health/health.service.spec.ts`: ok; degraded names failing dependency; hung dependency times out | Health status | 3/3 pass | Pass | VM | 2026-11-16 |
| T-API-001..009 | API-002..004, SEC-006, SEC-007, API-006 | `app.setup.spec.ts`: health 200 envelope; health 503 envelope; paginated envelope; validation + malformed JSON; unknown route NOT_FOUND; 500 hides details; Helmet headers; CORS allow-list; OpenAPI document served | HTTP stack per PRD | 9/9 pass | Pass | VM | 2026-11-16 |
| T-DB-001..004 | TEN-002, DB-001, DEC-018 | `infra/prisma/schema-tenancy.spec.ts`: 44 models; hospitalId everywhere except 3 global; only 4 optional; every tenant relation composite. Negative check performed: breaking one relation made the test fail | Tenancy rules in schema | 4/4 pass | Pass | VM | 2026-11-16 |
| T-WEB-001..004 | API-005, FE-001 | `lib/api-client.test.ts`: same-origin call + unwrap; backend error code; never resolves without `success: true`; network and non-JSON failures | Envelope-aware client | 4/4 pass | Pass | VM | 2026-11-16 |
| T-WEB-005..007 | FE-001 | `components/shared/system-status.test.tsx`: loading then all up; degraded shows down + retry works; network failure explained | UI states | 3/3 pass | Pass | VM | 2026-11-16 |
| T-INT-001 | SCOPE-001, CACHE-* | `test/health.int-spec.ts`: full AppModule, `GET /api/health` with real PostgreSQL, Redis, queue | 200, all up | 1/1 pass | Pass | **Mac** | 2026-11-16 |
| T-INT-002 | SEC-005, CACHE-003 | `test/health.int-spec.ts`: Redis throttler counts and blocks over limit | Hits counted, blocked | 1/1 pass | Pass | **Mac** | 2026-11-16 |
| T-AUTH-001 | TEST-013, SEC-004 | `auth.http.spec.ts`: refresh rotates; replaying the old token → 401 REFRESH_TOKEN_REUSED, every session of the user revoked, audit entry | As specified | Pass | Pass | VM | 2026-11-16 |
| T-AUTH-002 | AUTH-001, DEC-010/012 | register: PATIENT + patient profile + MRN, bcrypt cost 12, email OTP sent; unknown/unverified hospital code; duplicate email 409; password policy; future birth date; MRN collision retry | As specified | 6/6 pass | Pass | VM | 2026-11-16 |
| T-AUTH-003 | AUTH-006, DEC-011 | email OTP: login blocked until verified; wrong then right code; 5-attempt lock (429); resend identical for unknown accounts and during cooldown | As specified | 4/4 pass | Pass | VM | 2026-11-16 |
| T-AUTH-004 | AUTH-007, DEC-011 | phone OTP via SMS adapter for the signed-in user; requires authentication; dev SMS inbox order/clear; inbox route only outside production | As specified | 4/4 pass | Pass | VM | 2026-11-16 |
| T-AUTH-005 | AUTH-002, AUTH-011 | login: generic INVALID_CREDENTIALS for wrong password and unknown email (audited); token + cookie flags (HttpOnly, SameSite=Strict, Path=/api/auth); disabled account; suspended hospital | As specified | 3/3 pass | Pass | VM | 2026-11-16 |
| T-AUTH-006 | AUTH-008, AUTH-010 | logout one device vs all devices; access tokens of revoked sessions stop working at once; session store rotate/reuse/missing and revokeAll per user | As specified | 3/3 pass | Pass | VM | 2026-11-16 |
| T-AUTH-007 | AUTH-004/005 | forgot-password identical for unknown email (no mail); single-use reset link; weak password keeps token; reset revokes all sessions; old password rejected | As specified | 2/2 pass | Pass | VM | 2026-11-16 |
| T-AUTH-008 | AUTH-009 | `/auth/me` returns profile and role permissions; 401 without or with a malformed token | As specified | 2/2 pass | Pass | VM | 2026-11-16 |
| T-AUTH-009 | SEC-005 | auth limit per IP returns 429 RATE_LIMITED; non-auth routes unaffected; env defaults 100 / 15 min | As specified | 2/2 pass | Pass | VM | 2026-11-16 |
| T-AUTH-010 | SEC-010 | CSRF: missing or mismatched header 403; safe methods allowed; `@SkipCsrf()` honoured | As specified | 5/5 pass | Pass | VM | 2026-11-16 |
| T-AUTH-011 | DEC-013 | create-super-admin input validation | As specified | 2/2 pass | Pass | VM | 2026-11-16 |
| T-AUTH-012 | AUTH-002 | tokens: access/refresh round trip; type confusion rejected; tampered, foreign-secret and `alg: none` tokens rejected | As specified | 3/3 pass | Pass | VM | 2026-11-16 |
| T-RBAC-000 | ROLE-010 | `@Roles()` guard: 403 FORBIDDEN for unlisted role, open routes, public routes, anonymous | As specified | 2/2 pass | Pass | VM | 2026-11-16 |
| T-ENV-007 | DEC-011 | production refuses dev SMS inbox and Mailpit host; Twilio variables required | As specified | 1/1 pass | Pass | VM | 2026-11-16 |
| T-TEN-001 | TEN-002/003 | `tenant-scope.spec.ts`: 41 scoped models, 3 global untouched; hospitalId forced into every where; creates get hospitalId; other hospital or relation connect rejected; updates/upserts cannot move tenants; optional-hospital models scoped | As specified | 14/14 pass | Pass | VM | 2026-11-16 |
| T-TEN-002 | TEN-003/004 | `tenant-prisma.service.spec.ts`: hospital user sees only own hospital; Super Admin sees all and request is flagged; no context → error | As specified | 3/3 pass | Pass | VM | 2026-11-16 |
| T-TEN-003 | TEST-010, TEST-016 | `users.http.spec.ts` isolation: another hospital's users are 404 for GET/PATCH/DELETE with guessed ids, nothing changed; `?hospitalId=` of another hospital → 404; Super Admin cross-tenant write audited. Negative check performed: disabling User scoping made 2 tests fail | As specified | 2/2 pass (+3 related) | Pass | VM | 2026-11-16 |
| T-RBAC-001 | ROLE-011 | `permissions-matrix.spec.ts` from `docs/permissions-matrix.csv`: 19 routes × 9 roles (PUBLIC/ALLOW/OWN/DENY, anonymous 401, OWN on another record 403/404) plus "every registered route is in the matrix". Negative checks performed: one wrong cell and one missing row each failed | As specified | 172/172 pass | Pass | VM | 2026-11-16 |
| T-USR-001 | API-012 | `users.http.spec.ts`: list scoping, search/role/paging, limit validation; self-or-admin get; profile update clears phone verification; isActive admin-only and revokes sessions; unknown fields rejected; soft delete revokes sessions; no self-delete; CSRF required | As specified | 13/13 pass | Pass | VM | 2026-11-16 |
| T-AUD-001 | SEC-012 | audit interceptor: user.update/user.delete entries with actor, hospital, entity, IP and submitted field names; Super Admin reads audited; auth routes not double-logged | As specified | Pass (in users/auth specs) | Pass | VM | 2026-11-16 |
| T-AUD-002 | SEC-012, AUTH-012, DEC-030 | `common/audit/audit.spec.ts`: field names only; values only for declared safe scalar fields (still redacted); `safeChanges` drops raw bodies, redacts secrets, bounds size/depth; end to end: password, OTP, refresh token, diagnosis, notes and the bearer token never appear in stored audit rows | As specified | 3/3 pass | Pass | VM | 2026-11-16 |
| T-STA-007 | DEC-031 | `infra/prisma/sql-drift.spec.ts`: every hand-written `ADD CONSTRAINT … FOREIGN KEY/UNIQUE` (constraints.sql and migrations) is declared in schema.prisma by name. Negative check performed: the pre-fix schema failed 2 tests | Declared | 3/3 pass | Pass | VM | 2026-11-16 |
| T-MIG-000 | DB-020 | Initial migration `20261116085814_init` applied; appended part identical to constraints.sql (checked in VM: 36 enum types, 131 foreign keys, 0 DROP in the generated part) | Applies | Applied (owner report) | Pass | **Mac** | 2026-11-16 |
| T-MIG-007 | DEC-031 | `prisma:drift` after migration | Empty | 4 DROPs (same-tenant keys) → schema fix; re-run pending | Fail → fixed, re-check pending | **Mac** | 2026-11-16 |
| T-STA-001 | DEP-003 | Prettier, ESLint, TypeScript (all packages) | Clean | Clean | Pass | VM | 2026-11-16 |
| T-STA-002 | SCOPE-021 | `pnpm build` (types, API, web) | Builds | Builds | Pass | VM | 2026-11-16 |
| T-STA-003 | DB-001 | `prisma validate` schema revision 2 | Valid | Valid | Pass | VM (offline validator) | 2026-11-16 |
| T-STA-004 | DB-001 | `constraints.sql` parsed by PostgreSQL parser (pglast): 82 statements, 9 PL/pgSQL bodies; identifiers cross-checked against schema | Parses, names exist | Pass | Pass (syntax only; not executed) | Cloud workspace | 2026-11-16 |
| T-STA-005 | SCOPE-001 | Docker services PostgreSQL, Redis, Mailpit healthy | Healthy | Healthy (owner report) | Pass | **Mac** | 2026-11-16 |
| T-STA-006 | DB-020 | `prisma generate` | Succeeds | Succeeds (owner report) | Pass | **Mac** | 2026-11-16 |

Totals: API unit 291/291 (VM), web 7/7 (VM), integration 2/2 (Mac). CI: not run.
Not run yet: **T-AUTH-INT-001** (`test/auth.int-spec.ts`: register → Mailpit OTP → login → refresh → logout
→ audit rows, with the real role/profile trigger). It fails with an explicit message until the initial
migration exists (P1A-04). Also not run: **T-MIG-001..006** (`test/constraints.int-spec.ts`; T-MIG-005 covers audit, medical-record locks only so far; clinical correction triggers are tested with the EMR in Phase 4) and **T-TEN-INT-001** (`test/tenancy.int-spec.ts`: scoped client with real
queries, TENANT_MISMATCH, composite FK rejects a cross-tenant staff profile).
Not yet confirmed in a browser: web status page through the proxy, Swagger UI (Phase 0 checklist).

## 3. Planned tests (not run)

| Test ID | Req. | Scenario | Expected | Phase | Status |
| --- | --- | --- | --- | --- | --- |
| T-MIG-001 | DB-020, DEC-019 | `test/constraints.int-spec.ts`: 44 tables, 31 triggers, 2 exclusion constraints, pgcrypto + btree_gist | Applies cleanly; constraints present | 1A | Written, not run (needs migration) |
| T-MIG-002 | APPT-002, APPT-006 | Overlapping doctor appointment rejected by exclusion constraint; EMERGENCY allowed; patient overlap rejected | DB errors as designed | 1A | Written, not run |
| T-MIG-003 | DEC-017 | Role/profile trigger: each of the 9 roles valid and invalid combinations at commit | Only valid combinations commit | 1A | Written, not run |
| T-MIG-004 | DEC-018 | Child row pointing to a parent in another hospital rejected | FK violation | 1A | Written, not run |
| T-MIG-005 | DEC-016, EMR-002 | Append-only, status-only, closed-record and approved-lab locks; corrections require reason and same parent | Triggers fire as designed | 1A | Written, not run |
| T-MIG-006 | BILL-001, TEST-015 | Invoice CHECKs: total = subtotal + tax − discount; line total; item links | Violations rejected | 1A | Written, not run |
| T-AUTH-001 | TEST-013, SEC-004 | Refresh token reused after rotation → 401 and all sessions revoked | Rejected | 1B | Not run |
| T-AUTH-002..010 | AUTH-001..012 | Register, verify email/phone, login, me, refresh, logout one/all, forgot/reset, OTP attempt limit, auth rate limit 429, bcrypt cost, cookie flags, CSRF, no secrets in logs | As specified | 1B | Not run |
| T-RBAC-001 | ROLE-011 | Every endpoint × 9 roles matches `permissions-matrix.csv` | Allowed/denied per matrix | 1C | Not run |
| T-TEN-001 | TEST-010, TEST-016 | Doctor from hospital A gets 404 for every hospital B resource by id; lists exclude B | 404 / empty | 1C (CI required) | Not run |
| T-TEN-002 | TEST-011 | Patient cannot read another patient's records | 403/404 | 4 | Not run |
| T-APPT-001 | TEST-012 | Two simultaneous bookings of one slot: one 201, one 409 SLOT_UNAVAILABLE, repeated 20× | Exactly one succeeds | 3 | Not run |
| T-PH-001 | TEST-014 | Expired batch cannot be dispensed; FIFO uses valid batch | 422 MEDICINE_EXPIRED | 7 | Not run |
| T-BILL-001 | TEST-015, BILL-007 | Invoice total equals sum of lines; signed webhook accepted, bad signature rejected, replay ignored | As specified | 8 | Not run |
| T-E2E-001..004 | TEST-004 | Registration, book appointment, pay invoice, download report | Journeys succeed | 10+ | Not run |
| T-FE-001.. | Part 11 | Responsive (desktop, laptop, tablet, mobile), accessibility, navigation, form validation | No horizontal scroll, accessible | 1D onward | Not run |
