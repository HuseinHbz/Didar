# Redis failure runbook (CP-016)

For an on-call operator responding to a real Redis outage or degradation.
Companion to [`../architecture/redis-reliability.md`](../architecture/redis-reliability.md)
(why the system behaves this way) and
[`../security/redis-security.md`](../security/redis-security.md).

**The one fact to hold onto throughout this runbook: PostgreSQL is the
sole source of truth for every business record (orders, payments,
inventory, returns, settlements, …). Redis holds only BullMQ job
scheduling state. A Redis outage is an availability incident, not a data-
loss incident — no business record is ever only-in-Redis.**

## Symptom → cause map

| Symptom | Likely cause | Where to look first |
| --- | --- | --- |
| `services/api` won't start; logs show 5x `Redis unreachable at <host>:<port>` then exits | Redis unreachable at boot | `GET /health/ready` on a *running* instance (if one is still up) confirms; check the Redis host/port resolved from `REDIS_URL` is correct and reachable from the network the service runs on |
| `services/worker` / `services/notification-worker` container keeps restart-looping | Same startup preflight failure — these two have no HTTP surface, so a restart loop in your orchestrator's own dashboard is the only external signal | Check the process logs directly (`WaitForRedis` / `Bootstrap` logger tags) |
| `GET /api/v1/health` returns `200` but `GET /api/v1/health/ready` returns `503` with `redis.status: "down"` | Redis was reachable at boot but has since become unreachable — service is alive (DB is fine) but not fully ready | Take the instance out of a load balancer's ready-traffic rotation if your orchestrator doesn't already do this automatically from the readiness probe; do **not** restart the process — restarting won't fix an external Redis outage and will just repeat the (correctly bounded) startup preflight |
| New jobs stop appearing in downstream effects (no PDF invoices, no low-stock notifications, …) but the API itself responds normally | Redis reachable for the health-check `PING` but BullMQ producer/consumer traffic is stalled (e.g. `CLIENT PAUSE`-equivalent condition, network partial partition) | Check `GET /api/v1/health/ready`'s `redis` block first (rules out full unreachability); if it reports `up` but jobs still aren't flowing, check Redis's own metrics/logs directly (`INFO`, `CLIENT LIST`) |

## What to do

1. **Confirm the blast radius with `GET /api/v1/health/ready`** on every
   `services/api` instance. `database: up, redis: down` means exactly
   what it says — Postgres reads/writes still work, only queue-backed
   async work (emails, PDF generation, expiration sweeps, …) is affected.
2. **Do not restart `services/api` instances that are already running**
   just because Redis is down. A running instance with an established
   BullMQ connection relies on ioredis's own unbounded runtime retry/
   reconnect behavior (deliberately left untouched by this phase — see
   the architecture doc) — it will resume automatically once Redis comes
   back, with no lost jobs for anything already durably enqueued in
   Redis. Restarting just makes the instance re-run the startup preflight
   and fail to boot for as long as Redis stays down, taking capacity
   *out* of rotation for no benefit.
3. **`services/worker` / `services/notification-worker` instances that
   have already crash-looped past their startup preflight** will recover
   on their orchestrator's normal restart policy once Redis is reachable
   again — no manual intervention needed beyond restoring Redis itself.
4. **Restore Redis** (whatever that means for your deployment — restart
   the managed instance, fail over to a replica, resolve the network
   partition). This runbook does not prescribe Redis's own high-
   availability topology — that is a separate, larger operational
   decision outside CP-016's scope.
5. **Once Redis is back**, confirm recovery the same way outages were
   confirmed: `GET /api/v1/health/ready` returns `200` with
   `redis.status: "up"` on every instance, with no restarts required.
   Then confirm the actual queues drained (check your BullMQ
   dashboard/metrics, or the specific downstream effect you were missing
   in step 1 — e.g. new invoice PDFs resuming).
6. **If a queue-backed effect never resumes on its own** (rare — this
   would mean an in-flight job was lost, not merely delayed), several
   of this codebase's own domain modules already have independent,
   idempotent recovery mechanisms for exactly this class of problem —
   e.g. the `return` module's `return_settlement_recovery` queue and
   `ReturnReconciliationService.reconcileAll()` (see CP-013's own
   ADR-013 and `docs/product/integration-reconciliation.md`). Check
   whether the affected domain has a similar recovery sweep before
   assuming manual data repair is needed.

## What "no silent job loss" actually means here

This phase proved (see the architecture doc's "Live evidence" section)
that against a real, controlled Redis stall:

- A job add (`queue.add()`) issued while Redis is unreachable **blocks**
  rather than falsely reporting success — the caller sees the failure (a
  timeout, if the caller has one) and can react, rather than believing a
  job exists that doesn't.
- A job add that completes (because the caller waited out the stall, or
  Redis recovered before any client-side timeout) is processed
  automatically once the worker's connection is unblocked — no restart,
  no manual re-drive.

What this phase does **not** claim: that Redis's own process surviving a
hard kill with no persistence configured will retain unflushed
in-memory queue state. That is a Redis persistence/HA configuration
question for whoever operates the production Redis instance, deliberately
out of this phase's scope (see the architecture doc's non-goals) —
exactly why PostgreSQL, not Redis, is the one thing this system treats as
durable.
