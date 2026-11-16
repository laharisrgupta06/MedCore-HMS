# Phase 0 Checklist: Project Foundation

> Approved 2026-11-16 as part of housekeeping. Executed by the Team Lead in the project owner's local Claude Code session. No teammates exist during Phase 0, so the Team Lead owns every shared file. Source: `docs/implementation-roadmap.md` (Section 6, Phase 0) and the master development instruction (Part 7).
>
> **Gate:** do not start scaffolding until the prerequisites below are installed and verified on the project owner's Mac.

## Prerequisites (manual, on the Mac)

- [x] Node.js 24 LTS installed (v24.15.0), pinned in `.nvmrc`
- [x] pnpm 11.28.12 installed (user-owned npm prefix), pinned in root `package.json` `packageManager`
- [x] Docker Desktop for Apple Silicon installed (29.9.3), `docker run hello-world` succeeds
- [x] `docker compose version` works (5.7.0)
- [x] Ports 3000, 3001, 5432, 6379, 9000, 8025 free (verified 2026-11-16)

## Foundation items

| # | Item | Verified by |
| --- | --- | --- |
| 1 | pnpm workspace (`apps/api`, `apps/web`, `packages/types`, `packages/config`), root scripts, Node version pinned in `.nvmrc` | `pnpm install` |
| 2 | Shared strict TypeScript, ESLint and Prettier configs; `.vscode/settings.json` and `extensions.json` | `pnpm lint`, `pnpm typecheck`, `pnpm format:check` |
| 3 | `packages/types`: PRD response-envelope types (success, error, paginated) and the 9-role enum | Typecheck passes in both apps |
| 4 | NestJS API: global `/api` prefix, Helmet, CORS allow-list, `ValidationPipe`, envelope interceptor, exception filter, log sanitiser, throttler (Redis-backed), Swagger at `/api/docs` | API starts; error-envelope test |
| 5 | Typed environment validation that refuses to start on missing or weak secrets | Unit test |
| 6 | Prisma: datasource and generator only (the schema is the Database Engineer's work) | `prisma validate`; DB connection succeeds |
| 7 | Redis client and BullMQ connection; one test queue reported in the health check | Health check |
| 8 | `GET /api/health` reporting Postgres and Redis status | Integration test |
| 9 | Next.js 15 app: Tailwind, Shadcn initialised, route groups `(auth)`, `(dashboard)`, `(portal)`, TanStack Query, Zustand, `/api` same-origin proxy rewrite. No styled screens until design tokens are approved (`docs/frontend-design-system.md`) | Home page shows API status through the proxy |
| 10 | Docker Compose (dev): Postgres 16, Redis 7, MinIO, Mailpit with health checks and named volumes; Dockerfiles for api and web; Nginx config skeleton | `docker compose up -d` all services healthy |
| 11 | `.env.example` documenting every variable; local `.env` with dev-only values | `.env` is git-ignored |
| 12 | Jest + Supertest (API), Vitest + Testing Library (web), Playwright config | `pnpm test` passes |
| 13 | GitHub Actions on pull requests: install, lint, typecheck, unit and integration tests with Postgres and Redis services | Runs green after an approved push |
| 14 | README setup section | Project owner follows it once successfully |

## Out of scope for Phase 0

Prisma models, authentication, any hospital module, styled UI screens, provider SDKs (Stripe, Razorpay, Resend, Twilio, AWS S3), Multer, Sharp, Puppeteer. No AI or LLM packages, ever.

## Verification record

**Status: Phase 0 verified, 2026-11-16** (macOS results reported by the project owner). Two browser checks, the web proxy page and Swagger UI, are still to be confirmed.

Verified 2026-11-16 in the Linux build VM (Node 22, pnpm 11.28.12). Items marked "Mac" could not run
there (no Docker; `binaries.prisma.sh` is blocked by that VM's network) and must be confirmed on the
project owner's Mac or in CI before Phase 0 is closed.

| Check | Command | Result |
| --- | --- | --- |
| Install | `pnpm install` | Pass (lockfile committed) |
| Format | `pnpm format:check` | Pass |
| Lint | `pnpm lint` | Pass, 0 problems |
| Typecheck | `pnpm typecheck` | Pass (types, api, web) |
| Unit and component tests | `pnpm test` | Pass: API 37/37 (9 suites), web 7/7 (2 files) |
| Build | `pnpm build` | Pass: types, API (`nest build`), web (`next build`) |
| Prisma | `pnpm --filter @medcore/api prisma:generate` | Pass (Mac) |
| Docker services | `pnpm infra:up` then `pnpm infra:ps` | Pass (Mac): PostgreSQL, Redis, Mailpit healthy |
| Integration tests (real PostgreSQL + Redis) | `pnpm test:int` | Pass (Mac): 2/2, after fix `5571fe2` |
| API startup | full `AppModule` boot in `pnpm test:int` | Pass (Mac) |
| Web startup and proxy | `pnpm dev`, open http://localhost:3000 | Not yet reported (browser check) |
| Health check | `GET /api/health` in `pnpm test:int` (db, redis, queue all up) | Pass (Mac) |
| Swagger | open http://localhost:3001/api/docs | Not yet reported in a browser; OpenAPI document verified by unit test |
| CI | GitHub Actions on first push | Pending owner-approved push |

## Decisions and deviations recorded during implementation

| Topic | Decision | Reason |
| --- | --- | --- |
| Node / pnpm | Node 24 LTS, pnpm 11 | Approved by owner (Node 20 is end-of-life since 2026-04-30) |
| NestJS | 11.x (not 12) | NestJS 12 is ESM-only; 11 keeps Jest/Supertest/ts-jest simple and is still maintained |
| TypeScript | 5.9 (not 7) | `ts-jest` supports TypeScript below 7 only |
| Prisma | 6.19 (not 7/8) | 8 is a release candidate; 6 is stable and matches the roadmap's design |
| ESLint | 9 (flat config) | Plugin compatibility; ESLint 9 is marked deprecated upstream, revisit later |
| pnpm build scripts | `allowBuilds` in `pnpm-workspace.yaml`; `@scarf/scarf` (telemetry) denied | pnpm 11 blocks dependency build scripts by default |
| Prisma generate | Explicit script instead of `postinstall` | Keeps `pnpm install` working where engine downloads are blocked |
| Rate limiting | Redis-backed custom `ThrottlerStorage` (atomic Lua script); global 1000/min | PRD section 10; the 100/15 min auth limit is applied on auth routes in Phase 1 |
| Health endpoint | `GET /api/health`, 200 when PostgreSQL, Redis and the BullMQ queue respond, else 503 with details | Uses the PRD error envelope |
| Route groups `(auth)`, `(dashboard)`, `(portal)` | Created with their first real pages in Phase 1 | Avoids empty placeholder routes (Part 11 rule) |
| MinIO (local S3) | Not included in Phase 0 | No Phase 0 feature stores files; storage choice made in the phase that needs uploads |
| API Dockerfile, Nginx config | Moved to Phase 14 | Cannot be built or tested in this environment; untested deployment files are not committed |
| Web libraries not yet used (Recharts, Framer Motion, DOMPurify, socket.io-client) | Installed in the phase that uses them | Avoids unused dependencies |
