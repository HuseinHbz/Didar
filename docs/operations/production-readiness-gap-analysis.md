# Production readiness gap analysis — Phase 014 audit

Companion to [`docs/roadmap/master-roadmap-audit.md`](../roadmap/master-roadmap-audit.md)
§7. This is the first document under `docs/operations/` — no prior phase
produced an operations-specific doc tree, so this audit creates the
directory. Future SRE/production-readiness documentation should land here.

## What is real

- **CI quality gate**: 4 independently-reported jobs (`lint`/`test`/
  `security`/`build`) behind a `quality-gate` job requiring all four —
  real, well-structured, correctly using `concurrency` to cancel
  superseded runs.
- **Least-privilege database roles enforced by the pipeline itself**, not
  just documented (`test` job runs the e2e suite as `iecp_app`, not the
  migrator role).
- **Backup/restore scripts** (`infrastructure/postgres/scripts/`) from
  Phase 003.
- **Health check**: `GET /api/v1/health`, `@Public()`, real DB
  connectivity check — verified live in this session's own prior phase
  work (returns `{"status":"ok","info":{"database":{"status":"up"}}}`).
- **Graceful shutdown**: verified live in Phase 013's own validation gate
  — `SIGTERM` produces a clean process exit with no hang or stack trace,
  when Redis is reachable.
- **Secret scanning** (`gitleaks`, full history) wired into CI.

## Critical gap: CI cannot validate Redis-dependent boot, and the app has no fail-fast when Redis is unreachable

Fully detailed in the master audit §7 and risk register R2 — restated
here as the operations-specific framing: **a service that cannot start
without Redis (true since Phase 006) is validated by a CI pipeline that
never provisions Redis.** Reproduced live: killing Redis and booting the
compiled API produces an unbroken `ECONNREFUSED` retry loop, no crash, no
completion, no timeout anywhere in the code path that would surface this
as a legible failure rather than a silent hang. This is the single most
operationally dangerous finding in this audit — not because the fix is
hard (it is not — a Redis CI service + a `maxRetriesPerRequest` bound,
both small, both precedented by the existing Postgres-service pattern),
but because a hang-instead-of-crash failure mode is exactly the kind that
goes unnoticed until it costs real operational time in production.

## Other gaps

### O1 — No metrics endpoint

`infrastructure/monitoring/prometheus.yml` exists; nothing in `services/*`
emits `/metrics`. The scrape config points at a target that doesn't exist
yet.

### O2 — No alerting, no runbook, no incident-response documentation

Nothing under `docs/` or `infrastructure/monitoring/` addresses "what
happens when something breaks" beyond the health-check endpoint itself.

### O3 — No readiness/liveness distinction

`GET /api/v1/health` checks database connectivity only — it does not
check Redis reachability (relevant given the critical gap above: a
Redis-down instance currently reports itself healthy via this endpoint
while queue-dependent functionality silently degrades) and does not
distinguish "alive but not ready to serve traffic" from "fully healthy,"
a distinction most orchestrators (k8s readiness vs. liveness probes) rely
on.

### O4 — No load testing, no disaster-recovery plan, no restore drill on record

Backup scripts exist; nothing demonstrates they've ever been exercised on
a schedule, nor that a full restore has ever been timed or verified
end-to-end. No load test of any kind has been run against any module
(the "100 concurrent reservations" and "20 concurrent settlement calls"
proofs in the test suites are correctness proofs under concurrency, not
throughput/load tests — a real but different thing).

### O5 — No environment-separation documentation beyond `main`/`develop` branch strategy

`docs/deployment/ci-pipeline.md` covers the git branch strategy well; no
document describes how staging/production environment configuration
(secrets, `DATABASE_URL`, `REDIS_URL` per environment) is actually meant
to be managed operationally once real environments exist beyond this
sandbox and CI's ephemeral containers.

### O6 — Husky configured but inert (LOW, see risk register R11)

Local pre-commit enforcement doesn't exist; CI is the only real gate.

## Recommended minimum bar before any phase adds public/customer traffic

1. Gate 1 + Gate 2 from [`critical-path.md`](../roadmap/critical-path.md)
   (merge drift + Redis CI/fail-fast) — already the top of the roadmap.
2. `/metrics` wired + minimum 3-alert set (5xx rate, queue lag, DB
   connection saturation).
3. Split health check into liveness (process up) vs. readiness (DB **and**
   Redis reachable), matching how the app actually depends on both.
4. One documented, exercised restore drill.

None of this requires new infrastructure technology — Prometheus is
already chosen (`infrastructure/monitoring/prometheus.yml` exists), this
is wiring work, not a new decision.
