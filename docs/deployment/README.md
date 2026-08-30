# Deployment

Full target picture: [`docs/product/blueprint.md`](../product/blueprint.md)
§108-§109, §114-§120. This document is about what exists in this repo to support
deployment today — there is no deployed environment yet, anywhere.

## Environments (target)

```
local → development → staging → production
```

No direct `local → production` DB connection, ever (blueprint §108). Only
`local` exists in practice right now (via `infrastructure/docker/docker-compose.yml`).

## What's here today

- **Local dev**: `docker compose -f infrastructure/docker/docker-compose.yml up -d`
  for Postgres/Redis/OpenSearch, then `pnpm dev` for every app/service. See root
  `README.md`.
- **Containerization templates**: `infrastructure/docker/Dockerfile.next` and
  `Dockerfile.nest`, `turbo prune`-based, one per app/service — not build-tested
  yet, see that directory's `README.md`.
- **CI**: `.github/workflows/ci.yml` — four jobs (`lint`, `test`, `security`,
  `build`) gated by a `quality-gate` job, on every push/PR to `main`/`develop`.
  Full detail, branch strategy, and what still needs manual GitHub-admin setup
  (branch protection rules): [`ci-pipeline.md`](ci-pipeline.md). CI does not
  deploy anything yet — there is no CD pipeline.
- **Env vars**: every app/service ships `.env.example`; nothing is hardcoded,
  nothing is committed as a real secret (blueprint §109).

## Not set up yet

- Actual hosting target (which cloud, which region — blueprint mentions
  Cloudflare + Nginx/load balancer in front of the apps, blueprint §5/§114, but
  no infra-as-code exists to provision that).
- CD (auto-deploy on merge, staging promotion, production approval gate).
- Database backup/PITR/offsite (blueprint §101).
- Rollback tooling beyond "redeploy the previous image" (blueprint §116-§117).

## What CP-029 added

- **Load testing** (blueprint §104) — `scripts/load-test.mjs`
  (`pnpm load-test`) is real and has been run against a real
  `services/api` instance; see
  [`../operations/load-testing.md`](../operations/load-testing.md) for
  results and honest caveats about what a sandbox run can and cannot say
  about production capacity.
- **Disaster recovery / restore drill** —
  [`../operations/disaster-recovery.md`](../operations/disaster-recovery.md),
  including a real, timed, data-integrity-verified restore drill against
  this sandbox's own PostgreSQL.
- **Production observability** (`/metrics`, alerting rules, runbook,
  incident response) —
  [`../../infrastructure/monitoring/README.md`](../../infrastructure/monitoring/README.md),
  [`../operations/runbook.md`](../operations/runbook.md),
  [`../operations/incident-response.md`](../operations/incident-response.md).
- **Environment-configuration management** —
  [`environments.md`](environments.md).

## Versioning

Semantic versioning (`v0.1.0` → …) once there's a first real release — see root
`package.json`'s `version` field as the nominal source, currently `0.1.0` across
every workspace package (all still pre-release).
