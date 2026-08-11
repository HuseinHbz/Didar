# infrastructure/docker

## Local development: `docker-compose.yml`

Brings up Postgres 17, Redis 8, and a single-node OpenSearch — the stateful
infrastructure every app/service needs. Apps themselves run via `pnpm dev`
against these during day-to-day development:

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
cp packages/database/.env.example packages/database/.env   # + services/*/.env
pnpm --filter @iecp/database migrate:dev
pnpm dev
```

## Production-shaped images: `Dockerfile.next` / `Dockerfile.nest`

Two templates (Next.js apps vs. NestJS services need different runtime commands),
both using [`turbo prune`](https://turborepo.com/docs/reference/prune) so each
image only contains the one target app/service and what it actually depends on —
not the whole monorepo. Build from the **repo root**, not this directory.

| Target              | Dockerfile        | `PACKAGE_NAME`              | `APP_PATH`                     | `PORT` |
| ------------------- | ----------------- | --------------------------- | ------------------------------ | ------ |
| storefront          | `Dockerfile.next` | `@iecp/storefront`          | `apps/storefront`              | 3000   |
| admin               | `Dockerfile.next` | `@iecp/admin`               | `apps/admin`                   | 3001   |
| pwa                 | `Dockerfile.next` | `@iecp/pwa`                 | `apps/pwa`                     | 3002   |
| api                 | `Dockerfile.nest` | `@iecp/api`                 | `services/api`                 | 4000   |
| worker              | `Dockerfile.nest` | `@iecp/worker`              | `services/worker`              | (none) |
| notification-worker | `Dockerfile.nest` | `@iecp/notification-worker` | `services/notification-worker` | (none) |
| scheduler           | `Dockerfile.nest` | `@iecp/scheduler`           | `services/scheduler`           | (none) |

```bash
docker build \
  -f infrastructure/docker/Dockerfile.next \
  --build-arg PACKAGE_NAME=@iecp/storefront \
  --build-arg APP_PATH=apps/storefront \
  --build-arg PORT=3000 \
  -t iecp-storefront .
```

## ⚠️ Not build-tested here

These two Dockerfiles were written against the documented `turbo prune --docker`
pattern but have **not** been run through an actual `docker build` in the
environment this scaffold was generated in (large, slow, disk-heavy for a
structure-focused pass). Before depending on them for a real deployment: build
each target once locally, and add the build as a CI job (see
`.github/workflows/ci.yml`) so drift gets caught automatically.
