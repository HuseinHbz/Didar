# Redis reliability model (CP-016)

Full audit of every Redis dependency in this repository, performed by
reading source (not inferring from documentation), plus the design this
phase implements on top of it. Companion docs:
[`../deployment/redis-ci.md`](../deployment/redis-ci.md) (CI),
[`../operations/redis-failure-runbook.md`](../operations/redis-failure-runbook.md)
(what an operator does when Redis is down),
[`../security/redis-security.md`](../security/redis-security.md).

## The one rule that governs everything below

**PostgreSQL remains the sole source of truth for durable business
state. Redis is used only for BullMQ job scheduling — never for
business-state reads, never for sessions, never as a cache with
business-critical staleness implications.** Verified by grep across
every service: zero `new Redis(...)` client outside a `BullModule`
registration, zero direct `ioredis`/`createClient` usage anywhere. This
was already true before CP-016 and this phase does not change it — it
only makes the platform behave correctly when the one thing Redis _is_
used for (queue scheduling) is unavailable.

## Every Redis consumer, enumerated

| Service                                 | Registration                    | Queues                                                                           |
| --------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `services/api` (`cart-checkout` module) | `cart-checkout-queue.module.ts` | `checkout_expiration`, `cart_abandonment`                                        |
| `services/api` (`inventory` module)     | `inventory-queue.module.ts`     | `reservation_expiration`, `low_stock_notification`, `inventory_event_processing` |
| `services/api` (`order` module)         | `order-queue.module.ts`         | `order_conversion`, `invoice_generation`                                         |
| `services/api` (`payment` module)       | `payment-queue.module.ts`       | `payment_verification_retry`, `reconciliation`, `refund_status_sync`             |
| `services/api` (`promotion` module)     | `promotion-queue.module.ts`     | `promotion_expiration`, `coupon_reservation_cleanup`                             |
| `services/api` (`return` module)        | `return-queue.module.ts`        | `return_settlement_sync`, `return_settlement_recovery`, `return_reconciliation`  |
| `services/worker`                       | `app.module.ts`                 | `example` (scaffold queue — no real production queue lives here yet)             |
| `services/notification-worker`          | `app.module.ts`                 | one queue, dispatches to the 6 channel adapters (5 stubbed, `in-app` real)       |

**15 real BullMQ queues in `services/api`** (one process, one Redis
connection pool via 6 separate `BullModule.forRootAsync` registrations —
NestJS/BullMQ share the connection across queues registered in the same
process), plus 1 in each of the two standalone workers.
**`services/scheduler` uses no Redis at all** — confirmed by grep,
consistent with its own architecture doc (cron-driven via
`@nestjs/schedule`, not queue-driven).

Every one of these 8 `BullModule.forRootAsync` call sites has the
**exact same shape**: `connection: { url: config.getOrThrow<string>('REDIS_URL') }`
— no `maxRetriesPerRequest`, no custom `retryStrategy`, confirmed by
grepping every occurrence in the codebase before this phase's changes.

## Mandatory vs. optional Redis consumers

**All of the above are mandatory at the module level** — none of
`cart-checkout`/`inventory`/`order`/`payment`/`promotion`/`return`'s
`BullModule.forRootAsync` calls are conditionally registered; every one
runs unconditionally at `services/api` boot. This means `services/api`
as a whole has always required Redis to boot (true since Phase 006,
confirmed unchanged by this audit) — there is no "Redis-optional" mode
today, and this phase does not invent one (that would be new business
behavior, out of scope per this phase's own non-goals). What this phase
changes is **how the requirement is enforced**: today, an unreachable
Redis produces an indefinite silent hang; after this phase, it produces
a deterministic, logged, bounded failure.

`services/worker` and `services/notification-worker` are entirely
Redis-dependent by design (their only job is running BullMQ processors)
— Redis unavailability at their boot is unconditionally fatal for them,
correctly.

## The actual defect, precisely — not "add a retry limit"

The naive fix ("just set `maxRetriesPerRequest` on the BullMQ
connection") does not work and was not applied, because **BullMQ itself
forces `maxRetriesPerRequest = null` on any blocking (Worker) Redis
connection** — confirmed by reading `bullmq`'s own
`redis-connection.js` (`this.opts.maxRetriesPerRequest = null` is set
unconditionally for blocking connections, with a console warning if the
caller tries to override it). This is BullMQ's own documented
correctness requirement, not a bug: a worker's blocking commands
(`BRPOPLPUSH`-style) must never time out mid-wait, or jobs get
silently skipped. **This phase does not fight that** — runtime
resilience (a worker that's been running for days should absolutely
keep retrying through a transient Redis blip, not crash) is correct
behavior and stays unchanged.

The actual gap is **at startup**, before there has ever been a working
connection: ioredis's own connection-level `retryStrategy` (a different,
separate option from `maxRetriesPerRequest`, not overridden by BullMQ)
defaults to retrying forever with capped backoff, and nothing in any of
the three services' `main.ts` ever checked "did we actually reach Redis"
before declaring the process ready to serve/process. `services/api`
would sit inside Nest's own module-initialization lifecycle indefinitely
(empirically reproduced in the Phase 014 audit: killed Redis, booted the
compiled app, watched an unbroken `ECONNREFUSED` retry loop for 2+
minutes with no crash, no boot completion, no external signal
whatsoever). `services/worker`/`services/notification-worker` are worse
in this respect — being non-HTTP `createApplicationContext` processes,
they have no health endpoint at all to expose the stuck state through.

## The fix implemented by this phase

1. **A bounded, explicit Redis preflight check at process startup**, in
   every service's own `main.ts` (`src/bootstrap/wait-for-redis.ts`,
   duplicated per service — see "Mandatory vs. optional Redis consumers"
   above and this repo's existing per-service `env.ts` duplication
   convention). Pings Redis with a real RESP `PING` sent over a raw
   `node:net` socket — not an `ioredis` client, deliberately: this check
   must stay independent of BullMQ's own connection machinery (see next
   point), and a repo-root script can't resolve a service's
   `node_modules` under pnpm's non-hoisted layout anyway (the same reason
   `scripts/verify-redis.mjs` is zero-dependency). A bounded number of
   attempts (5) with capped linear backoff (1s/2s/3s/4s — not ioredis's
   own unbounded default), and a hard ceiling (~10-11s total). If Redis is
   still unreachable when the ceiling is hit, the process logs the
   resolved host/port (never the raw `REDIS_URL`, which can carry
   credentials in `redis://user:pass@host` form) and a clear, actionable
   error, then exits non-zero (`process.exit(1)`) — a deterministic,
   observable failure an orchestrator's restart policy or a human
   watching CI/logs can act on, instead of an indefinite silent hang.
2. **This preflight check is independent of BullMQ's own connection** —
   it opens and closes its own short-lived raw socket purely to prove
   reachability, then lets `BullModule.forRootAsync` establish its own
   connection exactly as before (runtime resilience unchanged).
3. **Health/readiness split** in `services/api`'s `HealthController`:
   `GET /api/v1/health` keeps its existing behavior. New
   `GET /api/v1/health/ready` additionally checks Redis (a real `PING`,
   not just "was the preflight check green at boot") — see
   [`../deployment/redis-ci.md`](../deployment/redis-ci.md) for why both
   endpoints matter for orchestration and CI alike.
4. **CI gets a real Redis service** (see
   [`../deployment/redis-ci.md`](../deployment/redis-ci.md)) so the gap
   this document describes is exercised — and would have been caught —
   by the platform's own quality gate.

## What this phase deliberately does not do

- Does not add a Redis cache layer, session store, or rate-limiter using
  Redis (rate limiting is CP-016's own listed non-goal territory here —
  it's a separate P1 item, not part of this P0 reliability fix).
- Does not change BullMQ's own runtime retry behavior for already-
  established worker connections — only the startup gate is new.
- Does not introduce Kubernetes, a service mesh, or any new
  infrastructure technology — the fix is entirely in application
  bootstrap code and the existing GitHub Actions workflow.
- Does not make Redis a business-critical source of truth anywhere —
  the fix closes an _availability_ gap (fail fast, don't hang), not a
  _correctness_ gap (Redis was never storing business state to begin
  with).

## Live evidence (real Redis, no mocks)

Every claim below was produced by actually killing/pausing/restarting a
real local `redis-server` process and observing real process exit codes,
real HTTP responses, and real BullMQ processor logs — never a mocked
Redis client. Two independent rounds of each failure/recovery pair were
run, per this phase's own `stability_rule`.

**Startup fail-fast, all three services, `node dist/main.js` (the real
production entrypoint, not `nest start --watch`, which is a long-lived
dev supervisor with different lifecycle semantics):**

| Service                        | Redis state      | Result                                                                                    |
| ------------------------------ | ---------------- | ----------------------------------------------------------------------------------------- |
| `services/worker`              | down (round 1)   | 5 logged attempts, `process.exit(1)` at **11s**                                           |
| `services/notification-worker` | down (round 1)   | 5 logged attempts, `process.exit(1)` at **11s**                                           |
| `services/worker`              | down (round 2)   | 5 logged attempts, `process.exit(1)` at **10s**                                           |
| `services/notification-worker` | down (round 2)   | 5 logged attempts, `process.exit(1)` at **10s**                                           |
| `services/worker`              | up (round 1 & 2) | boots and reaches "worker started, processors listening" on the first attempt, both times |
| `services/notification-worker` | up (round 1 & 2) | same                                                                                      |

This is the direct fix for the CP-014-reproduced defect (previously: 2+
minutes of unbroken `ECONNREFUSED` retries with no resolution). Now:
bounded, ~10-11s, deterministic, logged, non-zero exit.

**Liveness/readiness split, `services/api`, live HTTP requests against a
running instance:**

| Redis state        | `GET /health`               | `GET /health/ready`                                                                                                   |
| ------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| up                 | `200 {"status":"ok",...}`   | `200`, `info.redis.status: "up"`                                                                                      |
| down (round 1)     | `200` (unchanged — DB-only) | `503`, `error.redis.status: "down"`, message = `connect ECONNREFUSED 127.0.0.1:6379` (host:port only, no credentials) |
| up again (round 1) | `200`                       | `200`, recovered with no restart                                                                                      |
| down (round 2)     | `200`                       | `503`                                                                                                                 |
| up again (round 2) | `200`                       | `200`, recovered with no restart                                                                                      |

Automated regression coverage for this exact behavior lives in
`services/api/test/redis-reliability.e2e-spec.ts` (7 cases, all passing,
using a real closed TCP port for the "down" cases — a genuine
`ECONNREFUSED`, not a simulated one).

**BullMQ reliability under a real Redis stall (`redis-cli CLIENT PAUSE
... ALL`, which genuinely blocks Redis command processing for a window,
without killing the process or losing already-persisted data):**

1. Baseline: 3 jobs enqueued against a healthy Redis via the real
   `ExampleQueueService`/`bullmq` `Queue.add()` API — all 3 processed by
   the real `services/worker` process within the same second.
2. `CLIENT PAUSE 6000 ALL` issued first, _then_ `queue.add()` called with
   no client-side timeout: the call **genuinely blocked for the full 6s**
   pause window (ioredis queues the command rather than either failing
   silently or falsely reporting success), then completed and the worker
   processed both jobs the same second the pause lifted — **zero worker
   restart, zero silent job loss, zero manual intervention**.
3. A variant with a 5s client-side timeout wrapped around the same call,
   against an 8s pause: the timeout fired first, the `add()` call was
   abandoned, and — confirmed by inspecting `bull:example:*` keys in
   Redis directly afterward — **no job was created**. This is the correct,
   honest failure mode: the caller's own timeout decided the outcome, the
   caller observes a real rejection, and no phantom "queued" job exists
   that was actually dropped. Nothing about this is CP-016's to change —
   it is exactly "fails loudly, not silently."

Together these show BullMQ's own runtime resilience (untouched by this
phase, by design — see "What this phase deliberately does not do") does
what its documentation promises: a producer-side stall blocks and later
succeeds rather than lying about success, and a consumer that regains
connectivity resumes processing automatically, with no process restart
and no operator intervention required.
