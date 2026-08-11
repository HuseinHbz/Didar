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
- **CI**: `.github/workflows/ci.yml` runs install → lint → typecheck → build on
  every push/PR. It does not deploy anything, and there is no CD pipeline yet.
- **Env vars**: every app/service ships `.env.example`; nothing is hardcoded,
  nothing is committed as a real secret (blueprint §109).

## Not set up yet

- Actual hosting target (which cloud, which region — blueprint mentions
  Cloudflare + Nginx/load balancer in front of the apps, blueprint §5/§114, but
  no infra-as-code exists to provision that).
- CD (auto-deploy on merge, staging promotion, production approval gate).
- Database backup/PITR/offsite (blueprint §101).
- Rollback tooling beyond "redeploy the previous image" (blueprint §116-§117).
- Load testing (blueprint §104) — nothing has been load tested because nothing is
  deployed.

## Versioning

Semantic versioning (`v0.1.0` → …) once there's a first real release — see root
`package.json`'s `version` field as the nominal source, currently `0.1.0` across
every workspace package (all still pre-release).
