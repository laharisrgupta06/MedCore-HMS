# MedCore HMS

Multi-tenant hospital management platform: appointments, electronic medical records,
prescriptions, laboratory, pharmacy, billing and notifications for multiple hospitals from a
single deployment.

**Status:** Phase 0 (project foundation). Application modules are built phase by phase following
[`docs/implementation-roadmap.md`](docs/implementation-roadmap.md).

## Documentation

| Document                                                           | Purpose                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [`docs/prd/`](docs/prd/)                                           | Product Requirements Document (source of truth for requirements) |
| [`docs/implementation-roadmap.md`](docs/implementation-roadmap.md) | Architecture, database plan, API checklist, phases               |
| [`docs/phase-0-checklist.md`](docs/phase-0-checklist.md)           | Phase 0 items and verification record                            |
| [`docs/frontend-design-system.md`](docs/frontend-design-system.md) | Frontend design and engineering specification                    |
| [`docs/agent-teams-reference.md`](docs/agent-teams-reference.md)   | Claude Code Agent Teams reference                                |

## Tech stack

Next.js 15 (React 19, TypeScript, Tailwind CSS, Shadcn UI, TanStack Query, Zustand) ·
NestJS 11 · PostgreSQL 16 with Prisma 6 · Redis 7 · BullMQ · Socket.IO · Docker Compose ·
Jest, Supertest, Vitest, Playwright · GitHub Actions.

## Repository layout

```text
apps/api        NestJS REST API (port 3001, prefix /api, Swagger at /api/docs)
apps/web        Next.js frontend (port 3000); proxies /api/* to the API (same origin)
packages/types  API contract types shared by api and web (response envelope, roles)
packages/config Shared TypeScript configuration
e2e             Playwright end-to-end tests
docker          Local infrastructure (docker/compose.dev.yml)
docs            Requirements, roadmap, design system, checklists
```

## Prerequisites

- Node.js 24 LTS (`.nvmrc`)
- pnpm 11 (`npm install -g pnpm@11`)
- Docker Desktop (with Docker Compose)

## Local setup

```bash
pnpm install
cp .env.example .env        # then replace every placeholder (openssl rand -hex 32 for secrets)
pnpm infra:up               # PostgreSQL 16, Redis 7, Mailpit
pnpm --filter @medcore/api prisma:generate
pnpm dev                    # API on :3001, web on :3000
```

Open http://localhost:3000 to see the service status page (browser → Next.js proxy → API →
PostgreSQL/Redis). API docs: http://localhost:3001/api/docs. Mail inbox: http://localhost:8025.

## Scripts (repository root)

| Command                                     | What it does                                                |
| ------------------------------------------- | ----------------------------------------------------------- |
| `pnpm dev`                                  | Builds shared types, then runs API and web in watch mode    |
| `pnpm build`                                | Production build of every package                           |
| `pnpm lint` / `pnpm format:check`           | ESLint and Prettier for the whole monorepo                  |
| `pnpm typecheck`                            | TypeScript checks for every package                         |
| `pnpm test`                                 | Unit and component tests (no external services needed)      |
| `pnpm test:int`                             | API integration tests (requires `pnpm infra:up` and `.env`) |
| `pnpm infra:up` / `infra:down` / `infra:ps` | Manage local Docker services                                |

## API conventions

Every response uses the PRD envelope:

```json
{ "success": true, "data": {}, "message": "OK" }
{ "success": true, "data": [], "meta": { "page": 1, "limit": 20, "total": 348, "totalPages": 18 } }
{ "success": false, "error": { "code": "SLOT_UNAVAILABLE", "message": "This slot was just booked by another patient." } }
```

## Security notes

- `.env` is git-ignored; `.env.example` documents every variable. The API refuses to start with
  missing, placeholder or weak (under 256-bit) JWT secrets.
- Server secrets are never exposed to the browser (no `NEXT_PUBLIC_` secrets).
- Local Docker services bind to `127.0.0.1` only.

## Demo credentials

Added in Phase 14 with the seeded demo data (one login per role).
