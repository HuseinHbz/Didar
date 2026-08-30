# ADR-029 — Production Readiness Completion

## 1. Problem

`docs/product/gap-priority-matrix.md`'s P1-5 tracks "No production
observability (no `/metrics`, no alerting, no runbook)," with a split
owner: "**CP-016 delivered the minimum** (structured, credential-safe
logging around every Redis-related failure mode) → **CP-029** (full:
`/metrics`, alerting)." `canonical-roadmap.md`'s "one owner per
capability" table assigns CP-029 the broader capability: "Load
testing/DR/runbook/incident response." Blueprint PHASE 14 lists: Load
Test, Backup (CP-003's), DR, Monitoring, Alerting, Runbook, Incident
Response. This ADR scopes and records the decisions made closing exactly
that remainder.

## 2. Scope discipline — what this phase does NOT touch

| Item                                                                                   | Why not here                                                                                                                                                             |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backup/restore scripts themselves                                                      | Already real, owned by CP-003 (`infrastructure/postgres/scripts/`) — this phase exercises and documents them, does not rewrite them                                      |
| Grafana dashboards, Loki log aggregation, OpenTelemetry tracing, Sentry error tracking | Real, separate future work (blueprint §102's full stack); `gap-priority-matrix.md` never assigns these to CP-029, only `/metrics` + alerting                             |
| A deployed Prometheus/Alertmanager instance                                            | No infra-as-code or hosting target exists yet for anything (`docs/deployment/README.md`'s own "Not set up yet" list) — out of scope for any single phase                 |
| Rate limiting (`P1-1`)                                                                 | A different, already-assigned gap (`CP-017` or later) — never assigned to CP-029                                                                                         |
| PITR / WAL archiving / offsite backup copies                                           | A real, larger increment beyond the daily-full-backup CP-003 already delivers — explicitly named as not-yet-real in `disaster-recovery.md`, not silently claimed as done |

## 3. Production observability — `/metrics`

**Decision: `prom-client` directly, one shared module-level `Registry` per
process, no shared `packages/observability` package.**

Alternatives considered:

- **`@willsoto/nestjs-prometheus`** (the package `infrastructure/
monitoring/README.md`'s own pre-existing "suggested order of
  operations" named) — rejected in favor of `prom-client` used directly.
  The Nest-specific wrapper buys module-registration sugar this
  repository's own `services/worker`/`services/notification-worker`
  can't use anyway (they have no HTTP surface for Nest's own decorators
  to attach to — see §4), so using the same low-level library
  consistently across all three processes was simpler than two different
  metrics libraries for two different process shapes.
- **A shared `packages/observability` workspace package** — rejected for
  this pass. Every other piece of small, per-service infrastructure in
  this codebase (`bootstrap/wait-for-redis.ts`, each service's own
  `config/env.ts`) is already duplicated per service rather than shared,
  an established convention this phase followed rather than introduced a
  new architectural pattern to break.

What was actually built: `services/api` gets a real `GET /metrics` (its
own HTTP server, `/metrics` excluded from the `api/v1` global prefix —
see `main.ts`) exposing default process metrics, an HTTP request-duration
histogram (`iecp_http_request_duration_seconds`, labeled by route
_pattern_ not raw URL, to avoid cardinality explosion), and live
queue-depth gauges (`iecp_queue_jobs`) for every one of its 13 real
BullMQ queues. `services/worker` and `services/notification-worker` —
which have no HTTP surface at all today (see their own `main.ts` doc
comments) — each get a minimal standalone `node:http` listener
(`observability/metrics.server.ts`) on the port
`infrastructure/monitoring/prometheus.yml` already declared for them
(`:9090`), plus per-queue job-outcome counters/histograms wired through
`@OnWorkerEvent('completed'/'failed')`.

## 4. Alerting

**Decision: five Prometheus alerting rules, each backed by a metric this
phase actually emits — no rule referencing a metric that doesn't exist.**

`docs/operations/production-readiness-gap-analysis.md`'s own recommended
minimum bar named three: 5xx rate, queue lag, DB connection saturation.
DB connection saturation was **not** built — no Prisma connection-pool
metric was wired in this pass (a real but separate increment), so no
alert references one; inventing an alert against a metric this phase
doesn't emit would be exactly the kind of unverifiable claim this
project's rules forbid. What was built instead, all backed by real
metrics: `HighErrorRate`, `QueueBacklog`, `QueueFailureSpike`,
`ServiceDown` (Prometheus's own built-in `up` series — no application
code needed), `SlowRequests` — five, exceeding the stated minimum of
three without needing the one metric this pass didn't build.

## 5. Load testing

**Decision: a real `autocannon`-based load test (`scripts/load-test.mjs`,
`pnpm load-test`), run against this sandbox's own real `services/api`
instance, results recorded honestly with explicit caveats about what a
sandbox run can and cannot say about production capacity.**

`docs/product/phase-014-audit.md`'s own original finding was explicit
that this codebase's existing "100 concurrent reservations"/"20
concurrent settlement calls" tests are _correctness-under-concurrency_
proofs, not _throughput_ load tests — a real distinction this phase
closes rather than blurs. See `docs/operations/load-testing.md` for the
actual run's numbers (7,474 requests, 0% errors, p99 69ms) and its own
explicit "what this does not prove" section (production-scale capacity,
write-path load, multi-instance behavior, sustained long-duration load).

## 6. Disaster recovery / restore drill

**Decision: exercise CP-003's existing `backup.sh`/`restore.sh` for real
against this sandbox's real, seeded PostgreSQL, verify data integrity by
exact row-count comparison (not just "did `pg_restore` exit 0"), and
document the result plus the drill's own honest limits.**

See `docs/operations/disaster-recovery.md` for the full evidence: an
18MB real backup, a 3-second restore into a scratch database, and an
exact 265,191-row match across all 110 tables in all 11 domain schemas
between the source and restored databases — the first restore drill on
record for this repository, closing exactly the gap
`gap-priority-matrix.md`'s P1-5 named ("no restore drill on record").

## 7. Runbook / incident response

**Decision: `docs/operations/runbook.md` as the general-purpose entry
point, cross-referencing (not duplicating) the existing
`redis-failure-runbook.md`; `docs/operations/incident-response.md` as the
severity/process/postmortem-template document.**

Both are new documents `gap-priority-matrix.md`'s P1-5 explicitly named
as missing ("no alerting, no runbook"). Neither invents a paging tool,
on-call schedule, or notification-channel wiring — both documents
explicitly say so, consistent with this phase's own scope discipline
(§2) and with `infrastructure/monitoring/README.md`'s own "not configured
here" note for Alertmanager receivers.

## 8. Environment-configuration documentation

**Decision: `docs/deployment/environments.md` points at each service's
own `config/env.ts` (the actual, code-enforced list of what an
environment must set) rather than maintaining a second, independently-
drifting list of environment variables.**

Closes O5 of `production-readiness-gap-analysis.md`. No secret-management
product is prescribed — that remains a real infrastructure decision for
whoever operates a real deployment, the same category of decision this
phase's other new documents already decline to make unilaterally.

## Consequences

- `docs/product/roadmap.json`'s CP-029 entry moves from `NOT_STARTED`/0%
  to `IMPLEMENTED`, `blockingIssues` cleared of `P1-5`.
- No schema/migration change — this phase adds observability code,
  scripts, and documentation only.
- CP-029 does not, and cannot, claim a deployed Prometheus/Alertmanager,
  Grafana dashboards, log aggregation, tracing, or a live restore of a
  genuinely lost production database — all explicitly named as not-yet-
  real in this ADR and the documents it points to.
- Human approval for CP-019's Q1–Q5 domain decisions is untouched by this
  ADR — a different phase, a different gate, no relationship to this
  one's scope.
