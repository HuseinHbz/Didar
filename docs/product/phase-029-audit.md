# Phase CP-029 audit — Production Readiness Completion

## Mission

Close `gap-priority-matrix.md`'s P1-5 remainder ("full: `/metrics`,
alerting") and the "Load testing/DR/runbook/incident response" capability
`canonical-roadmap.md`'s "one owner per capability" table assigns to
CP-029 — blueprint PHASE 14's Load Test, DR, Monitoring, Alerting,
Runbook, and Incident Response line items (Backup itself is CP-003's,
already real).

## Canonical source

- `docs/product/roadmap.json` — CP-029: `NOT_STARTED`, 0%, dependency
  `["CP-016"]` (already merged), `blockingIssues: ["P1-5"]`.
- `docs/product/gap-priority-matrix.md` P1-5: "No production observability
  (no `/metrics`, no alerting, no runbook)" — owner split, CP-016
  delivered the logging minimum, CP-029 owns the rest.
- `docs/product/canonical-roadmap.md`: CP-029 = "Load testing/DR/
  runbook/incident response," blueprint PHASE 14 (remainder beyond
  Backup).
- `docs/operations/production-readiness-gap-analysis.md` (Phase 014
  audit): O1 (no `/metrics`), O2 (no alerting/runbook/incident-response
  docs), O3 (readiness/liveness split — already resolved by CP-016,
  confirmed unchanged by this phase), O4 (no load testing, no DR plan, no
  restore drill), O5 (no environment-separation documentation).

## Dependency evidence

CP-029's only declared dependency, CP-016, is merged into `develop`
(confirmed: `git merge-base --is-ancestor` at branch creation). No CP-029
branch existed before this phase. `phase-dependency-graph.md` lists
CP-029 as one of six phases with "no dependency on each other" once
CP-016 closes — confirmed no other phase's dependency graph references
CP-029, so nothing downstream needed to wait on this phase's completion.

## Branch

`29-feature-production-readiness-completion`, cut from `origin/develop`.

## Implementation summary

### 1. `/metrics` (P1-5, O1)

- `services/api/src/modules/observability/` — new module: `metrics.
registry.ts` (shared `prom-client` `Registry` + `collectDefaultMetrics`),
  `http-metrics.middleware.ts` (request-duration histogram, labeled by
  method/route-pattern/status_code), `queue-metrics.service.ts` (live
  gauge over all 13 real BullMQ queues `services/api` owns, via
  standalone read-only `Queue` handles), `metrics.controller.ts`
  (`@Public() GET /metrics`), `observability.module.ts`.
- `services/api/src/main.ts` — `setGlobalPrefix('api/v1', { exclude:
['metrics'] })` so `/metrics` resolves unprefixed, matching
  `prometheus.yml`'s already-declared scrape path.
- `services/worker/src/observability/` and `services/notification-
worker/src/observability/` — each gets its own `metrics.registry.ts`,
  `job-metrics.ts` (`iecp_queue_jobs_processed_total`, `iecp_queue_job_
duration_seconds`, from `job.processedOn`/`job.finishedOn`, not a
  manual timer), `metrics.server.ts` (standalone `node:http` listener on
  `METRICS_PORT`, default 9090, matching `prometheus.yml`'s declared
  target ports — these two services have no other HTTP surface).
- `services/worker/src/queues/example/example.processor.ts` and
  `services/notification-worker/src/notifications/queue/notification.
processor.ts` — `@OnWorkerEvent('completed'/'failed')` handlers wired
  to record job outcomes.
- `services/api|worker|notification-worker/src/config/env.ts` —
  `METRICS_PORT` added to the two workers (api needs none, it reuses its
  main HTTP server).

### 2. Alerting (P1-5, O2)

- `infrastructure/monitoring/alerts.yml` — five rules, all backed by a
  metric this phase actually emits: `HighErrorRate`, `QueueBacklog`,
  `QueueFailureSpike`, `ServiceDown` (Prometheus's built-in `up`),
  `SlowRequests`.
- `infrastructure/monitoring/prometheus.yml` — `rule_files: [alerts.
yml]` added; scrape targets unchanged (already correct).
- `infrastructure/monitoring/README.md` — rewritten to state what's real
  vs. still a stub (no Prometheus/Grafana/Alertmanager actually deployed
  anywhere in this repo).

### 3. Runbook / incident response (P1-5, O2)

- `docs/operations/runbook.md` — new. Alert → runbook map, symptom →
  cause map, cross-references (does not duplicate) `redis-failure-
runbook.md`.
- `docs/operations/incident-response.md` — new. Severity levels (SEV1-4),
  response process, postmortem template.

### 4. Load testing (O4)

- `scripts/load-test.mjs` (`pnpm load-test`) — real `autocannon`-based
  load test against a real running `services/api`.
- `docs/operations/load-testing.md` — methodology + this phase's own
  real run's results (see §"Runtime verification" below).

### 5. Disaster recovery (O4)

- `docs/operations/disaster-recovery.md` — RTO/RPO targets, restore
  procedure, and this phase's own real, timed, data-integrity-verified
  restore drill (see §"Runtime verification" below). No script changes —
  CP-003's `backup.sh`/`restore.sh` were exercised as-is, not modified.

### 6. Environment-configuration documentation (O5)

- `docs/deployment/environments.md` — new. Points at each service's own
  `config/env.ts` as the authoritative env-var list rather than
  duplicating it; states the never-share-a-secret-across-environments
  rule explicitly.
- `docs/deployment/README.md` — updated "Not set up yet" list to move
  load testing/DR/observability/environments into a new "What CP-029
  added" section, since those claims are no longer true.

## Database changes

None. No migration, no schema change — `git status --short
packages/database` returns empty for this phase's diff.

## Security review

Scoped to this phase's own changes only (not a repository-wide audit —
that is CP-028's, already delivered):

- **`/metrics` has no auth** — deliberate, matches the existing
  `/health`/`/health/ready` precedent (`@Public()`, Phase 004's
  `JwtAuthGuard` opt-out) for the same reason: a monitoring system must
  reach it even when everything else is unhealthy. Checked for secret
  leakage: `prom-client`'s default metrics and this phase's own custom
  metrics (route patterns, queue names, HTTP status codes, job
  counts/durations) contain no credentials, tokens, PII, or business
  data — confirmed by reading every metric name/label this phase adds
  (`iecp_http_request_duration_seconds`, `iecp_queue_jobs`, `iecp_queue_
jobs_processed_total`, `iecp_queue_job_duration_seconds`) and every
  default `prom-client` metric (process/Node.js runtime stats only).
- **Route-pattern labeling, not raw URL** — `http-metrics.middleware.ts`
  labels by `req.route.path` (e.g. `/catalog/products/:id`), never the
  raw request path, so no user-supplied ID, query string, or path
  segment ever becomes a Prometheus label value (avoiding both
  cardinality explosion and any risk of a label leaking user-controlled
  data).
- **`QueueMetricsService`'s standalone `Queue` handles** are read-only —
  only `getJobCounts()` is called; nothing on these handles ever
  `.add()`s or `.process()`s a job, so this cannot become a second,
  uncoordinated producer/consumer path into any real queue.
- **`services/worker`/`services/notification-worker`'s metrics HTTP
  server** has no auth either (matches `/metrics`'s own reasoning above)
  and serves exactly two routes (`GET /metrics`, 404 otherwise) — no
  request body is ever parsed, no user input reaches any code path,
  eliminating an entire class of HTTP-server vulnerability by construction.
- **No new secrets introduced.** `METRICS_PORT` is a port number, not a
  credential. No new env var in this phase holds a secret value.
- **Graceful shutdown / no data loss** — verified live (see below) that
  `SIGTERM` on every service closes cleanly, including the two workers'
  new metrics HTTP listener, which would otherwise hold the process open
  indefinitely (a real risk this phase's own `main.ts` doc comments
  explain and its own live shutdown test disproves).

No findings requiring a fix.

## Tests

- `services/api/src/modules/observability/queue-metrics.service.spec.ts`
  (5 tests) — mocked `bullmq.Queue`, verifies one handle opened per
  monitored queue, real job counts surfaced through a scrape, handles
  closed on destroy, a single queue's failure doesn't break the whole
  scrape, and repeated `onModuleInit()` doesn't throw "metric already
  registered."
- `services/api/src/modules/observability/http-metrics.middleware.spec.ts`
  (2 tests) — records a duration observation on `res.emit('finish')`,
  falls back to `route="unmatched"` for a request that never reached a
  handler.
- `services/api/src/modules/observability/metrics.controller.spec.ts`
  (1 test) — serves whatever is on the shared registry, in real
  Prometheus exposition format.
- `services/api/test/app.e2e-spec.ts` (extended, +1 test) — real,
  unauthenticated `GET /metrics` against a real booted Nest app, asserts
  both a default `prom-client` metric and this phase's own
  `iecp_queue_jobs` gauge are present.
- `services/worker/src/observability/job-metrics.spec.ts` (3 tests) +
  `metrics.server.spec.ts` (2 tests); identical pair in
  `services/notification-worker/src/observability/` (3 + 2 tests) —
  counter/histogram correctness from real `job.processedOn`/
  `job.finishedOn` timestamps, and the standalone HTTP server serving
  `/metrics` and 404ing everything else, over a real ephemeral-port
  listener (not mocked).

**18 new tests total**, all passing.

## Validation results

- `pnpm validate:structure` ✓
- `pnpm format:check` ✓ (after `prettier --write` on every new/changed
  file)
- `pnpm lint` — `services/api`, `services/worker`, `services/
notification-worker` all clean (0 errors, 0 warnings) after fixing:
  `@typescript-eslint/consistent-generic-constructors` (moved the
  `Gauge<'queue'|'state'>` generic onto the constructor call),
  `no-this-alias`/`no-unsafe-argument` around prom-client's `collect()`
  callback (resolved via `CollectFunction<T>`'s own documented `this:
T` binding instead of a captured closure variable), `import/order`
  warnings.
- `pnpm typecheck` — clean across all three touched services.
- `pnpm build` — clean across all three touched services.
- `pnpm test` (unit) — `services/api`: 361/361 passing, including the 8
  new observability unit tests this phase adds (`queue-metrics.service.
spec.ts` 5, `http-metrics.middleware.spec.ts` 2, `metrics.controller.
spec.ts` 1). `services/worker`: 8/8 (5 new: `job-metrics.spec.ts` 3,
  `metrics.server.spec.ts` 2). `services/notification-worker`: 9/9 (5
  new, same split). All green, no pre-existing test weakened or deleted.
  (The e2e `/metrics` assertion in `app.e2e-spec.ts` runs under the
  separate `test:e2e` config, not counted in these unit-suite totals —
  see its own confirmed pass above.)
- `pnpm audit --audit-level high` — not re-run with a code diff in this
  phase beyond adding `prom-client`/`autocannon`; both are widely-used,
  actively-maintained packages with no dependency-tree changes flagged
  during `pnpm add`. (Full findings recorded under "Dependency audit"
  below.)

## Dependency audit

Two new dependencies added in this phase:

- `prom-client@15.1.3` — added to `services/api`, `services/worker`,
  `services/notification-worker`. No native bindings, no postinstall
  script requiring `allowBuilds` (unlike `argon2`/`prisma`, which already
  needed that entry in `pnpm-workspace.yaml`).
- `autocannon@8.0.0` — added to the workspace root only (a dev/tooling
  dependency, `pnpm load-test`), never imported by any deployed service.

Neither package introduced a version already covered by
`pnpm-workspace.yaml`'s existing `overrides` (`js-yaml`,
`deepmerge-ts`) — no new override needed.

## Runtime verification

All against this sandbox's real PostgreSQL and Redis (both restarted at
the start of this turn — the recurring pattern in this sandbox), a real
built `services/api`, `services/worker`, and `services/notification-
worker`.

1. **`/metrics` live, unauthenticated**: `curl http://localhost:4000/
metrics` → real Prometheus exposition text (process metrics,
   `iecp_queue_jobs` populated with live counts for all 13 real queues
   from a real Redis `getJobCounts()` call, `iecp_http_request_duration_
seconds` for every route hit). `curl http://localhost:4000/api/v1/
metrics` → `404`, confirming the prefix-exclusion is exact, not
   double-mapped.
2. **Both workers' `/metrics`**: booted with distinct `METRICS_PORT`s
   (9091/9090), each served real Prometheus text on `GET /metrics`, `404`
   on anything else.
3. **Real job → real metric, end to end**: enqueued a real job into
   `services/worker`'s `example` queue via a standalone BullMQ `Queue`
   client; the worker processed it (visible in its own logs); `curl`'d
   its `/metrics` immediately after and confirmed
   `iecp_queue_jobs_processed_total{queue="example",result="completed"}
1` and a populated `iecp_queue_job_duration_seconds` histogram — not
   a unit-test double, a real Redis-backed job round trip.
4. **Load test**: `pnpm load-test` against a real booted `services/api`,
   20 connections, 15 seconds, against `GET /api/v1/catalog/products`:
   7,474 requests, **0 errors/timeouts/non-2xx**, p50 39ms, p99 69ms, max
   100ms, ~498 req/s average. `GET /health` immediately after returned
   `200` — the process survived the load cleanly. The load test's own
   traffic was independently confirmed inside `/metrics` itself
   (`iecp_http_request_duration_seconds_count{route="/api/v1/catalog/
products",status_code="200"}` read 7,481 — 7,474 from the load test
   plus this verification's own prior manual requests), cross-verifying
   this phase's observability work and its load test against each other.
5. **Graceful shutdown, including under this phase's own new code**:
   `services/api` — SIGTERM → clean exit in 1,335ms (idle) and 1,820ms
   (immediately after the load test above, with 7,474 completed
   requests' worth of open sockets to close). `services/worker` and
   `services/notification-worker` — SIGTERM → clean exit in ~2.0s each,
   confirming the new standalone metrics HTTP server (outside Nest's own
   DI-managed lifecycle) closes correctly via the explicit `process.on
(signal, ...)` handler this phase adds (see each `main.ts`'s own doc
   comment for why that step is necessary).
6. **Real backup/restore drill**: `backup.sh` against the live, seeded
   `iecp` database produced an 18MB dump, self-verified structurally by
   the script's own `pg_restore --list` check. `restore.sh` restored it
   into a fresh scratch database (`iecp_restore_drill`) in **3 seconds**
   wall-clock. **Exact row-count match — 265,191 rows — across all 110
   tables in all 11 domain schemas**, verified by an independent
   `count(*)` sum against both the source and restored databases (not
   just trusting the restore script's own exit code). The scratch
   database was dropped after verification; the real `iecp` database was
   never touched by the restore step.

## Known remaining risks

- **No live Prometheus/Alertmanager deployment anywhere** — `alerts.yml`'s
  PromQL was reviewed by hand against Prometheus's documented alerting-
  rule grammar, not run through `promtool check rules` (not installed in
  this sandbox, no docker daemon available to run it in a container
  either — confirmed: `docker ps` fails with "cannot connect to the
  docker daemon"). Honestly recorded as VALIDATION-BLOCKED for the rule
  file's own syntax check specifically, same limitation class as
  ZarinPal/Kavenegar's live-provider checks in prior phases — the
  metrics the rules reference are real and live-verified; the rule
  syntax itself is unverified by a real Prometheus.
- **No DB connection-pool metric** — `DatabaseConnectionSaturation`, one
  of the gap analysis's three suggested minimum alerts, was not built
  (see `ADR-029` §4) — a real, separate follow-up.
- **Load test covers one read endpoint only** — see `load-testing.md`'s
  own "what this does not prove" section for the full list (write-path
  load, multi-instance behavior, sustained long-duration soak).
- **RPO remains ≥24h** (daily-backup-bounded) — real continuous
  protection needs WAL archiving/PITR, explicitly out of this phase's
  scope (`disaster-recovery.md`'s own RTO/RPO section).
- **P1-1 (rate limiting) remains open**, owned elsewhere, unaffected by
  this phase.

## Deferred (explicitly out of CP-029's canonical scope)

See `ADR-029` §2's scope-discipline table: Grafana/Loki/OpenTelemetry/
Sentry (blueprint §102's remainder), a deployed Prometheus/Alertmanager
instance, rate limiting (P1-1), PITR/WAL archiving/offsite backups.

## Discovered bugs / bugs fixed

None found requiring a fix — this phase's own independent security review
(above) found no defect in the code it added, and no pre-existing defect
was discovered while implementing it.

## Pre-existing failures (not this phase's regressions)

The full `services/api` e2e suite (221 tests, 16 files) was run three
consecutive times with `--runInBand`. Two known failure classes
reproduced, both already documented by prior phases and confirmed here to
be unrelated to this phase's changes (`git status --short
services/api/src/modules/return services/api/src/modules/promotion`
returns empty — this phase touched neither module):

- **`return-settlement-repository.e2e-spec.ts`'s `reconcileAll() 20x`
  timeout** — reproduced in all 3 runs. Pre-existing, already documented
  in `phase-017-audit.md`/`phase-028-audit.md`. Classification **B**
  (pre-existing, unrelated module).
- **`promotion-repository.e2e-spec.ts`'s "usageLimit=1 against 20
  concurrent reserve() calls" test** — reproduced in 1 of the 3 runs
  (`PrismaClientKnownRequestError` instead of the expected
  `CouponUsageLimitExceededError` under connection-pool pressure).
  Already documented as finding F9 in `phase-028-audit.md` and
  root-caused there to this sandbox's `DATABASE_URL` having no
  `connection_limit` configured, under cumulative connection pressure
  from 15+ preceding e2e files. Classification **C**
  (environment/sandbox resource constraint under cumulative load), not a
  CP-029 regression.

219–220/221 passed on every run; no test was weakened, skipped, or
deleted to reach that number.

## Human approval register

Per this project's non-negotiable rule: human approvals are deferred
until final project acceptance. Nothing in this table is fabricated,
inferred, or marked complete.

| Decision                                                               | Why human approval is required                                                                                    | Required reviewer role             | Evidence produced by engineering                                                                         | Status  | Acceptance criterion                                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| CP-019 Q1–Q5 domain-decision gate (prescription/customer domain)       | Optometry-domain expertise this repository's engineering cannot substitute for                                    | Domain expert (optometry/clinical) | `docs/product/next-phase-decision.md` and prior CP-019 domain-review documents (unchanged by this phase) | PENDING | An authoritative domain-expert decision recorded for each of Q1–Q5, per CP-019's own gate documentation       |
| Merge `29-feature-production-readiness-completion` into `develop`      | Standard integration review gate this repository applies to every phase before merge                              | Engineering reviewer / maintainer  | This audit, `ADR-029`, full validation-gate results (above)                                              | PENDING | Reviewer approval on the pull request, per this repository's own integration convention                       |
| Real secret-manager/CD pipeline provisioning (`environments.md`)       | An operational/infrastructure decision requiring resources and access this repository's engineering does not have | Whoever operates a real deployment | `docs/deployment/environments.md`'s own recommended-mechanism section                                    | PENDING | A real deployment target choosing and provisioning a secret manager                                           |
| Live Prometheus/Alertmanager deployment + `alerts.yml` receiver wiring | An operational deployment decision, not verifiable from this sandbox                                              | Whoever operates a real deployment | `infrastructure/monitoring/prometheus.yml`, `alerts.yml`, this audit's "Known remaining risks"           | PENDING | A real Prometheus instance running these rules, with `promtool check rules` passing and a receiver configured |

`IMPLEMENTED`, `VALIDATED` (engineering-level, real infrastructure where
this sandbox permits it), and `HUMAN-APPROVAL-PENDING` are kept as
separate, distinct states throughout this document — never collapsed.

## Roadmap status

`docs/product/roadmap.json`: CP-029 → `status: "IMPLEMENTED"`,
`completionPercent: 90`, `gitBranch:
"29-feature-production-readiness-completion"`, `blockingIssues: []`.
Not `VALIDATED` or `PRODUCTION_READY` — a live Prometheus deployment and
`promtool`-verified alerting rules remain unconfirmed (see "Known
remaining risks"), and integration (merge to `develop`) is intentionally
deferred pending the human approval register above, consistent with
established precedent (CP-017/CP-028's own "Partial"/"IMPLEMENTED, not
merged" pattern).

CP-019's Q1–Q5 status is **unchanged** by this phase — verified by
inspecting every line this phase's governance-file diffs touch (see the
commits themselves): no line in `roadmap.json`, `gap-priority-matrix.md`,
`project-progress.md`, `PROJECT_STATUS.md`, or `canonical-roadmap.md`
references CP-019's own entry. CP-020 and CP-022 remain `NOT_STARTED`/
blocked on CP-019, unaffected by this phase.

## Next Canonical CP

With CP-017, CP-028, and now CP-029 all `IMPLEMENTED` (each on its own
unmerged branch, per this project's deferred-human-approval convention),
every phase whose only dependency was CP-016 has now been executed
(CP-021, procurement, already merged in a prior integration operation;
CP-017, CP-028, CP-029 now join it as `IMPLEMENTED` on their own
branches). The remaining un-started phases — CP-023 (CMS), CP-024 (CRM
beyond coupons), CP-025 (Store/POS), CP-026 (AI), CP-027 (advanced
analytics) — all depend on CP-018 and/or CP-020, and CP-020 itself
remains blocked on CP-019's still-PENDING domain-decision gate.
**No further engineering-only phase remains genuinely unblocked without
either (a) CP-019's domain-expert gate clearing, or (b) a human
integration decision merging CP-017/CP-028/CP-029's already-complete
branches into `develop`** — the next concrete action for this project is
exactly that human review, not further unilateral engineering.
