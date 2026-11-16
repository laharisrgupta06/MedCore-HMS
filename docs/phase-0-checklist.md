# Phase 0 Checklist: Project Foundation

> Approved 2026-11-16 as part of housekeeping. Executed by the Team Lead in the project owner's local Claude Code session. No teammates exist during Phase 0, so the Team Lead owns every shared file. Source: `docs/implementation-roadmap.md` (Section 6, Phase 0) and the master development instruction (Part 7).
>
> **Gate:** do not start scaffolding until the prerequisites below are installed and verified on the project owner's Mac.

## Prerequisites (manual, on the Mac)

- [ ] Node.js version for the project confirmed and installed (via nvm), pinned in `.nvmrc`
- [ ] pnpm installed (via Corepack) and version pinned in root `package.json` `packageManager`
- [ ] Docker Desktop for Apple Silicon installed, running, `docker run hello-world` succeeds
- [ ] `docker compose version` works
- [ ] Ports 3000, 3001, 5432, 6379, 9000, 8025 free (verified free on 2026-11-16)

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

Fill in with actual command output after implementation. Do not mark an item verified without running it.

| Check | Command | Result | Date |
| --- | --- | --- | --- |
| Install | `pnpm install` | | |
| Build | `pnpm build` | | |
| Typecheck | `pnpm typecheck` | | |
| Lint | `pnpm lint` | | |
| Format | `pnpm format:check` | | |
| Docker services | `docker compose -f docker/compose.dev.yml ps` | | |
| Database | health check `db` field | | |
| Redis | health check `redis` field | | |
| API startup | `pnpm --filter api dev` | | |
| Web startup | `pnpm --filter web dev` | | |
| Health check | `curl localhost:3000/api/health` (through proxy) | | |
| Swagger | open `localhost:3001/api/docs` | | |
| Tests | `pnpm test` | | |
