# @iecp/api

The API gateway every client (`storefront`, `admin`, `pwa`, `mobile`) talks to —
NestJS, domain-based modules (blueprint §2), clean architecture layering within
each module (blueprint §3). See `src/modules/identity/README.md` for the concrete
layering example.

- **Global prefix**: `/api/v1` (blueprint §70 — versioned from day one).
- **Docs**: Swagger UI at `/api/v1/docs` once running.
- **Health**: `GET /api/v1/health` — no auth, checks DB connectivity.
- **Security baseline**: `helmet()`, CORS restricted to `CORS_ORIGIN`,
  whitelist+forbidNonWhitelisted `ValidationPipe` (extra/unknown fields are
  rejected, not silently dropped).

## Modules that exist so far

| Module     | What's real                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `health`   | Fully real — DB liveness check via `@iecp/database`.                                                                                                |
| `identity` | Structurally real (full clean-architecture layering, DI, tests), but backed by the placeholder `User` model — see `src/modules/identity/README.md`. |

Every other domain in blueprint §2 (`customer`, `catalog`, `order`, `inventory`, …)
doesn't exist yet — it lands once its slice of the Phase 1 ERD is designed.

## Running locally

```bash
cp .env.example .env                          # then point DATABASE_URL at a real Postgres
pnpm --filter @iecp/database migrate:dev      # creates the `users` table
pnpm --filter @iecp/api dev                   # http://localhost:4000/api/v1
```

Or via Docker Compose — see `infrastructure/docker/docker-compose.yml` — which
brings up Postgres/Redis/OpenSearch for the whole monorepo at once.

## Tests

```bash
pnpm --filter @iecp/api test        # unit tests — no DB required (see get-user-by-id.usecase.spec.ts)
pnpm --filter @iecp/api test:e2e    # e2e — requires DATABASE_URL to be reachable
```
