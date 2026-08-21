# Redis in CI (CP-016)

Companion to [`../architecture/redis-reliability.md`](../architecture/redis-reliability.md)
(the architecture/defect account) and
[`../operations/redis-failure-runbook.md`](../operations/redis-failure-runbook.md)
(what an operator does in production). This document covers only
`.github/workflows/ci.yml`'s own Redis wiring.

## What changed

Before this phase, `.github/workflows/ci.yml`'s `test` job ran a real
`postgres:17-alpine` service container but **no Redis at all** — every
Redis-dependent code path (every `services/api` domain module's
`BullModule.forRootAsync`, both standalone workers) was either never
exercised by CI, or ran against whatever Redis happened to already be
resident on the runner (undefined, unverified). This was the CP-014-
identified, CP-015-reconfirmed P0 gap this phase closes.

Three additions, all in the `test` job:

1. **A `redis:7.4-alpine` service container**, alongside the existing
   `postgres:17-alpine` one:
   ```yaml
   redis:
     image: redis:7.4-alpine
     ports:
       - 6379:6379
     options: >-
       --health-cmd "redis-cli ping"
       --health-interval 5s
       --health-timeout 5s
       --health-retries 10
   ```
   GitHub Actions' own service-container semantics guarantee every step
   in the job waits until **both** the Postgres and Redis containers
   report healthy before running — this ordering is enforced by the
   platform itself, not by anything this repo has to implement.

2. **An explicit connectivity-verification step**, after the database
   seed step and before the e2e test step:
   ```yaml
   - name: Verify Redis connectivity
     run: node scripts/verify-redis.mjs
   ```
   [`scripts/verify-redis.mjs`](../../scripts/verify-redis.mjs) is a
   zero-dependency script (matching this repo's existing root-`scripts/`
   convention — `validate-structure.mjs`, `roadmap-audit.mjs` — since a
   repo-root script can't resolve any single service's own
   `node_modules` under pnpm's non-hoisted workspace layout). It sends a
   real RESP `PING` over a raw `node:net` socket, retries up to 5 times
   with capped backoff, and exits non-zero if Redis never answers — so a
   Redis-container problem fails the build at this explicit step, with a
   clear message, rather than surfacing later as a confusing, unrelated-
   looking e2e failure or timeout.

3. **`timeout-minutes: 20`** on the `test` job — a ceiling that would
   have turned the CP-014-reproduced indefinite-hang defect into a bounded
   (if slow) CI failure even before this phase's actual fix landed. Kept
   as defense in depth alongside the real fix (the startup preflight
   check — see the architecture doc), not a substitute for it.

## Why the health-check options matter

`--health-cmd "redis-cli ping"` with `--health-retries 10` at a 5s
interval gives the container up to 50s to become ready before GitHub
Actions will route traffic to it — generous enough for a cold pull of the
`redis:7.4-alpine` image on a fresh runner, while still bounded (unlike
the application-level defect this phase fixes, an unhealthy service
container that never passes its health check causes the *step* that
needs it to fail with a clear "service unhealthy" message, not a silent
hang).

## What this does not change

- Does not add Redis to any job other than `test` — no other CI job in
  this workflow currently touches Redis-dependent code.
- Does not change the Postgres service container or the migration/seed
  steps that already existed — those are unrelated to this phase's scope.
- Does not add Redis persistence (`--appendonly`) to the CI container —
  CI's Redis is disposable per-run by design, matching this repo's own
  invariant that Redis never holds durable business state (see the
  architecture doc's "one rule that governs everything").
