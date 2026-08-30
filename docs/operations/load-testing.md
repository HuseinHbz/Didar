# Load testing (CP-029)

Closes the "no load test of any kind" half of `gap-priority-matrix.md`'s
P1-5 and O4 of `production-readiness-gap-analysis.md`. That document was
explicit about the distinction this closes: "the '100 concurrent
reservations' and '20 concurrent settlement calls' proofs in the test
suites are correctness proofs under concurrency, not throughput/load
tests — a real but different thing." This is the throughput/load test.

## Tool and method

`scripts/load-test.mjs` (`pnpm load-test`) — a thin wrapper around
[`autocannon`](https://github.com/mcollina/autocannon), a real HTTP load
generator, against a real, already-running `services/api` instance. Not a
mock, not a synthetic report — sustained concurrent HTTP traffic against
the real Nest application, real PostgreSQL, real route handlers.

```bash
# Boot a real services/api instance first (see services/api's own README),
# then:
pnpm load-test
# or, to tune target/load:
TARGET_URL=http://localhost:4000/api/v1/catalog/products CONNECTIONS=20 DURATION=15 pnpm load-test
```

Default target: `GET /api/v1/catalog/products` — a real, `@Public()`,
PostgreSQL-backed read endpoint (no auth, no write side-effects, so
repeated runs don't corrupt state), representative of the storefront's
actual highest-traffic access pattern (product browsing).

## Live evidence — this phase's own run

Against this sandbox's real, seeded PostgreSQL and a real `services/api`
process (no mocks), 20 concurrent connections for 15 seconds:

| Metric                                     | Result                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Total requests                             | 7,474                                                                                                                                                                                                                                                                                                                          |
| Errors / timeouts / non-2xx                | 0 (0.00%)                                                                                                                                                                                                                                                                                                                      |
| Throughput                                 | ~498 req/s average                                                                                                                                                                                                                                                                                                             |
| Latency p50                                | 39 ms                                                                                                                                                                                                                                                                                                                          |
| Latency p99                                | 69 ms                                                                                                                                                                                                                                                                                                                          |
| Latency max                                | 100 ms                                                                                                                                                                                                                                                                                                                         |
| Process survived                           | Yes — `GET /health` returned `200` immediately after the run                                                                                                                                                                                                                                                                   |
| Graceful shutdown after load               | Yes — `SIGTERM` produced a clean exit in 1,820ms with no hang, timed immediately after this run                                                                                                                                                                                                                                |
| Metrics pipeline captured the real traffic | Yes — `/metrics`'s own `iecp_http_request_duration_seconds_count{route="/api/v1/catalog/products",status_code="200"}` read 7,481 after the run (7,474 from the load test itself plus a handful of this document's own manual verification requests) — the CP-029 observability work and this load test cross-verify each other |

Zero errors, zero timeouts, sub-100ms max latency, clean shutdown
immediately after — this codebase's catalog read path holds up under
sustained concurrent load in this environment.

## What this does not prove

- **Production-scale capacity.** This ran against a single-container
  sandbox sharing CPU/memory with everything else in this session (the
  test suites, the database, this very process). A dedicated production
  host's real capacity is unmeasured — this proves the code path is
  sound under load, not a specific production throughput ceiling.
- **Write-path load.** Only a read endpoint was tested (deliberately, to
  keep repeated runs non-destructive and comparable). Checkout/order/
  payment write paths have their own _concurrency-correctness_ proofs
  (the "100 concurrent reservations" class of test this document's own
  opening paragraph distinguishes from load testing) but not a
  _throughput_ load test in this pass.
- **Multi-instance/horizontal-scaling behavior.** This ran against one
  process. Load-balanced multi-instance behavior (session affinity, if
  any; shared Redis/Postgres contention across instances) is untested.
- **Sustained long-duration load** (hours, not seconds) — this was a
  15-second run; memory-leak-under-sustained-load is a different,
  longer-running test class not attempted here.

## Recommended follow-up (not built in this pass)

- A write-path load test against a scoped, cleanup-safe endpoint (e.g.
  cart creation, not checkout completion).
- A longer-duration soak test once a real staging environment exists —
  this sandbox's ephemeral, shared-resource nature makes a multi-hour run
  here non-representative of anything real.
