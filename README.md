# Didar — IECP (Iran Eyewear Commerce Platform)

Didar (دیدار, Persian for "meeting" or "encounter") is the working name for an
**Iranian Eyewear Commerce Platform**. [Lenskart](https://www.lenskart.com) is the
functional benchmark, not the spec: the goal is an enterprise-grade commerce
platform (catalog, CMS, CRM, inventory, POS, loyalty, marketing, AI, mobile, PWA,
notifications, analytics) tailored to the Iranian market — not a reskinned clone.

Four clients (`storefront` Web, `admin` panel, `pwa` installable mobile-first, and
`mobile` native Android via Flutter), one shared backend, PostgreSQL as the single
source of truth for everything business- and content-related.

## Documentation

- **[`docs/product/blueprint.md`](docs/product/blueprint.md)** — the full product
  and architecture blueprint: scope, Lenskart benchmark comparison, architecture
  decisions, domain model, database design, phased build plan. Start here.
- **[`CLAUDE.md`](CLAUDE.md)** — condensed summary of the non-negotiable
  architecture rules and current project status, for quick orientation.
- **[`docs/README.md`](docs/README.md)** — index of the architecture/database/
  api/security/deployment docs, each tracking what's real vs. still planned.
- **[`CONTRIBUTING.md`](CONTRIBUTING.md)** — how to work in this repo.

## Repository structure

```
apps/
├── storefront/    — customer web storefront (Next.js 16, desktop-first)
├── admin/         — admin panel (Next.js 16)
├── pwa/           — installable mobile-first PWA (Next.js 16 + Serwist)
└── mobile/        — Android app (Flutter — SDK not bootstrapped here yet, see its README)

services/
├── api/                   — API gateway every client talks to (NestJS)
├── worker/                — generic background jobs (BullMQ)
├── notification-worker/   — SMS/Telegram/WhatsApp/Email/Push/In-App dispatch
└── scheduler/              — cron-driven tasks (@nestjs/schedule)

packages/
├── ui/              — shared React components (Tailwind v4 + shadcn/ui conventions)
├── database/        — Prisma ORM client (the only way any service touches PostgreSQL)
├── types/           — shared domain types (Money, branded IDs, cross-cutting enums)
├── validation/      — shared Zod schemas (same rules on client + server)
├── config/          — shared strict tsconfig bases
└── eslint-config/   — shared ESLint flat configs (bans `any`, enforces strict TS)

infrastructure/   — docker-compose (Postgres/Redis/OpenSearch), Dockerfiles, nginx, monitoring
docs/             — architecture, database, api, security, deployment status docs
```

Every directory above has its own `README.md` — read the local one before working
in it.

## Getting started

Requires Node ≥20.9, [pnpm](https://pnpm.io) 10.33.0 (`corepack enable` picks it
up automatically from `packageManager` in `package.json`), and Docker.

```bash
git clone https://github.com/HuseinHbz/Didar.git && cd Didar
pnpm install

# Local infrastructure (Postgres, Redis, OpenSearch)
docker compose -f infrastructure/docker/docker-compose.yml up -d

# Env vars — copy the example in every app/service that has one
for f in packages/database services/api services/worker services/notification-worker services/scheduler apps/storefront apps/admin apps/pwa; do
  [ -f "$f/.env.example" ] && [ ! -f "$f/.env" ] && cp "$f/.env.example" "$f/.env"
done

pnpm --filter @iecp/database migrate:dev   # creates the (placeholder) `users` table
pnpm build                                  # builds shared packages, then everything else
pnpm dev                                    # runs every app/service in watch mode
```

| App/service  | URL                                                   |
| ------------ | ----------------------------------------------------- |
| `storefront` | http://localhost:3000                                 |
| `admin`      | http://localhost:3001                                 |
| `pwa`        | http://localhost:3002                                 |
| `api`        | http://localhost:4000/api/v1 (docs at `/api/v1/docs`) |

### Other commands

```bash
pnpm lint          # eslint across every workspace
pnpm format:check   # prettier --check
pnpm typecheck      # tsc --noEmit across every workspace
pnpm test           # unit tests (jest/vitest) across every workspace
pnpm validate:structure   # verifies the required repo layout exists (see scripts/validate-structure.mjs)
pnpm audit --audit-level high   # dependency vulnerability scan
pnpm format         # prettier --write
```

CI runs all of these (plus a secret scan and an integration-test pass) as four
independently-reported jobs — `lint`, `test`, `security`, `build` — behind a
single `quality-gate` check. See `docs/deployment/ci-pipeline.md` for the full
branch strategy and pipeline breakdown.

Run any of these against one workspace with `pnpm --filter <name> <script>`, e.g.
`pnpm --filter @iecp/api test:e2e`.

## Rules (enforced, not just written down)

- TypeScript strict mode everywhere (`packages/config`), `any` is a lint error
  everywhere (`packages/eslint-config`) — see `CONTRIBUTING.md`.
- No business-critical data hardcoded in frontend code — see `CLAUDE.md`.
- Every module (app/service/package) ships its own `README.md`.
- Clean architecture in `services/*`: `domain/ → application/ → infrastructure/` +
  `presentation/`, see `services/api/src/modules/identity/README.md` for the
  worked example.

## Status

Phase 0 (product/architecture definition), the Phase 001 monorepo-foundation
task, Phase 003's real PostgreSQL ERD, Phase 004's identity/RBAC module, and
Phase 005's product catalog/merchandising module are done — see `CLAUDE.md`'s
"Current status" for exactly what each does and doesn't include. Next up: the
remaining Phase 1 domain modules (`customer`, `order`, `inventory`, …).

## License

See [LICENSE](./LICENSE).
