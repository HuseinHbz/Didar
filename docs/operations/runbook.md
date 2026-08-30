# Operational runbook (CP-029)

For an on-call operator responding to a production alert or an outage.
This is the general-purpose entry point — some incident classes already
have their own dedicated runbook, cross-referenced below rather than
duplicated here.

**The one fact to hold onto throughout this runbook, same as the Redis
one: PostgreSQL is the sole source of truth for every business record.
Redis holds only BullMQ job scheduling state. An outage that leaves
PostgreSQL intact is an availability incident, not a data-loss incident.**

## Where to look first

- `GET /health` — is the process alive and can it reach its database.
- `GET /health/ready` — is every dependency (database **and** Redis)
  currently reachable. Use this, not `/health`, to decide whether an
  instance belongs in load-balancer rotation.
- `GET /metrics` — real-time process, HTTP, and queue metrics (CP-029,
  see `infrastructure/monitoring/README.md` for what each metric means).
  No auth required, same as the health endpoints, for the same reason:
  a monitoring system must be able to reach it even when everything else
  is unhealthy.
- Application logs — every service tags its logger by class name (e.g.
  `[Bootstrap]`, `[WaitForRedis]`, `[QueueMetricsService]`); grep for the
  tag relevant to the symptom.

## Alert → runbook map

| Alert (`infrastructure/monitoring/alerts.yml`) | What it means                                                                                                | Where to look                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `HighErrorRate`                                | >5% of `iecp-api` responses are 5xx over 5 minutes                                                           | Application logs for the failing routes; `GET /health/ready` to rule out a dependency outage first                 |
| `QueueBacklog`                                 | A queue's waiting-job count hasn't drained in 15 minutes                                                     | `GET /metrics`'s `iecp_queue_jobs{queue="...",state="waiting"}`; is the corresponding worker process even running? |
| `QueueFailureSpike`                            | A worker is failing more jobs than it completes, per queue, over 10 minutes                                  | The worker's own logs for that queue's processor; check the failing job's error in BullMQ directly if reachable    |
| `ServiceDown`                                  | Prometheus has failed to scrape a target (`iecp-api`/`iecp-worker`/`iecp-notification-worker`) for 2 minutes | Is the process actually running? Boot logs for a crash-on-startup (see "Symptom → cause map" below)                |
| `SlowRequests`                                 | p99 request latency above 2s for 10 minutes                                                                  | Database connection saturation, an external provider call blocking the event loop, or genuine load                 |

## Symptom → cause map (general)

| Symptom                                                                         | Likely cause                                                                         | Where to look first                                                                                                  |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Redis-related startup failure, `/health/ready` reporting `redis: down`          | Redis outage/unreachability                                                          | **[`redis-failure-runbook.md`](redis-failure-runbook.md)** — do not duplicate that investigation here                |
| `services/api` won't start at all, exits immediately                            | Invalid/missing environment configuration (Zod validation failure)                   | The exact env var name is in the crash log's own error message (`Invalid environment configuration: - VAR: ...`)     |
| `/health` returns `200` but `/health/ready` returns `503` with `database: down` | Postgres unreachable                                                                 | Confirm `DATABASE_URL` resolves and the database is reachable from where the service runs; check Postgres's own logs |
| A queue's `iecp_queue_jobs{state="failed"}` count is climbing                   | Jobs failing repeatedly, e.g. an external provider outage (ZarinPal, Kavenegar)      | The relevant worker's logs; both known external-provider gaps are documented in their own ADRs (ADR-008, ADR-014)    |
| `iecp_queue_jobs{state="waiting"}` climbing with no corresponding `active`      | The worker process for that queue isn't running or isn't connected to the same Redis | Confirm the worker process is up; confirm its `REDIS_URL` matches the API's                                          |

## Restarting a service

Every service in this repository (`services/api`, `services/worker`,
`services/notification-worker`) handles `SIGTERM`/`SIGINT` gracefully —
verified live for this phase (see
`docs/product/phase-029-audit.md` §11): the Nest application context
closes cleanly, and for the two worker services, their `/metrics` HTTP
listener is closed explicitly alongside it (see
`services/worker/src/main.ts`'s own doc comment for why that needs a
separate step). A restart is safe to issue at any time; it does not
orphan open connections or leave a process stuck.

## Restore drill

See [`disaster-recovery.md`](disaster-recovery.md) for the backup/restore
procedure and this phase's own timed restore-drill evidence.

## Load characteristics

See [`load-testing.md`](load-testing.md) for what has actually been
measured, and its own honest caveats about what a single-container
sandbox run can and cannot say about real production capacity.

## Escalation

See [`incident-response.md`](incident-response.md) for severity
classification and escalation.
