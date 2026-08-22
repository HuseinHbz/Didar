# Phase 016 Audit (CP-016 — Platform Reliability Foundation)

Required audit output for CP-016, matching the shape
[`phase-015-audit.md`](phase-015-audit.md) established. Full evidence:
[`../architecture/redis-reliability.md`](../architecture/redis-reliability.md)
and its deployment/operations/security companions.

## Overall Project Progress

Per [`project-progress.md`](project-progress.md) and `roadmap.json`'s
`aggregate`: **17 of 30 canonical phases Completed, 0 Partial, 0 in
progress, 13 Planned.** CP-016 moved from Planned to Completed as a
direct result of this phase — the only status transition on this
phase's own scope.

## Completed Phases

CP-000 through CP-016 (17 phases). CP-016 newly reached `VALIDATED`
status in this phase — full detail in [`project-progress.md`](project-progress.md).

## Partial Phases

None.

## Planned Phases

CP-017 through CP-029 (13 phases), unchanged by this phase's own scope.

## P0 Gaps

| ID   | Gap                                                                     | Status after CP-016                                                                                                                                        |
| ---- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 | CP-012/013 not merged into `develop`                                    | **RESOLVED** (by CP-015, unchanged by this phase)                                                                                                          |
| P0-2 | CI has no Redis service; app has no fail-fast when Redis is unreachable | **RESOLVED** — real `redis:7.4-alpine` CI service + connectivity check; bounded startup preflight (all 3 Redis-dependent services); live-proven twice each |

Both P0s the Phase 014 audit found are now closed. No new P0 discovered
by this phase.

## P1/P2 Gaps

| ID   | Gap                                         | Status after CP-016                                                                                                                                                                                                               |
| ---- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 | No rate limiting anywhere in `services/api` | Still open — **explicitly deferred by this phase's own non-goals** ("no unrelated changes" — a rate limiter is a separate, orthogonal concern from Redis reliability)                                                             |
| P1-5 | No production observability                 | **Minimum delivered**: structured, credential-safe logging around every Redis-related failure mode, live-verified (see `docs/security/redis-security.md`). Full form (`/metrics`, alerting) remains **CP-029**'s scope, unchanged |

Full table: [`gap-priority-matrix.md`](gap-priority-matrix.md).

## Roadmap Divergence

None. This phase's scope (P0-2 only, per its own mission) matches
exactly what `gap-priority-matrix.md` already assigned to CP-016 for
the P0 dimension. The P1-1/P1-5 assignments that also named CP-016 were
explicitly re-scoped in this phase's own kickoff as non-goals (P1-1
entirely; P1-5 to a "minimum" only) — reflected in the gap matrix's own
updated ownership notes, not a silent divergence.

## Architecture Findings

The actual defect was **not** "add a retry limit" — BullMQ itself forces
`maxRetriesPerRequest = null` on blocking (Worker) Redis connections
(confirmed by reading `bullmq`'s own `redis-connection.js`), so naively
bounding that option does nothing and was never applied. The real gap
was a missing **startup-time** reachability check, independent of
BullMQ's own connection, in all three Redis-dependent services'
`main.ts`. Fixed by a bounded (5 attempts, capped backoff, ~10-11s
ceiling), independent raw-socket RESP `PING` preflight — replacing what
was previously an indefinite silent hang (CP-014 audit: 2+ minutes of
unbroken `ECONNREFUSED` retries, no crash, no external signal). Full
account: [`../architecture/redis-reliability.md`](../architecture/redis-reliability.md).

## Security Risks

None found. The new code follows a single, enforced, live-verified rule
everywhere it touches `REDIS_URL`: log only the resolved `host:port`,
never the raw URL (which can carry credentials). `GET /health/ready`'s
response body was checked directly, live, against the real `REDIS_URL`
value and confirmed to never contain it. No new attack surface —
Redis's own threat model (holds only BullMQ scheduling state, never
sessions/auth/business data) is unchanged. Full detail:
[`../security/redis-security.md`](../security/redis-security.md).

## Database Risks

None. No schema change in this phase. Fresh-database migration proof
re-run (11/11 migrations applied cleanly to a genuinely new database,
`prisma migrate status` reports "Database schema is up to date!",
`prisma migrate diff` against the same fresh database reports "This is
an empty migration" — zero drift, same technique CP-015 established).

## Testing Risks

Two pre-existing, non-regression e2e failures reproduced consistently
across both required consecutive full-suite runs (200/202 both times,
identical two failing tests both times):

- `return-settlement-repository.e2e-spec.ts`'s 20-iteration
  `reconcileAll()` idempotency test exceeds Jest's 5000ms default
  timeout on this sandbox's large, long-lived database — the exact
  same finding CP-015 already diagnosed and documented as non-
  regression. Re-confirmed passing in isolation with an extended
  timeout (27.9s, 10/10 tests).
- `promotion-repository.e2e-spec.ts`'s 20-concurrent-`reserve()` test
  fails only under the load of the full 202-test suite, never in
  isolation (confirmed: 8/8 passing standalone, twice). Unrelated to
  this phase's changes (no promotion/coupon code touched) — a
  sandbox-load-sensitivity finding of the same class as the one above,
  not a functional defect.

Neither is caused by, or related to, this phase's changes. All new
tests this phase added (4 unit-test files, 1 seven-case e2e spec) pass
100% across both runs. 336/336 unit tests pass repo-wide (both api's
own 332 pre-existing plus this phase's 4 new, plus worker's and
notification-worker's new tests).

## Production Readiness

Meaningfully improved on the one dimension this phase owns: CI now
actually exercises Redis-dependent code paths against a real Redis, and
every Redis-dependent service now fails deterministically instead of
hanging when Redis is unreachable at boot — a real production
reliability property, not a documentation-only claim. Rate limiting
(P1-1) and full observability (P1-5) remain open, unchanged, by this
phase's own explicit non-goals — owned by later phases (CP-029 for the
full observability form).

## Current Phase

**CP-016 — Platform Reliability Foundation.** Complete.

## Next Phase

**CP-017 (Real Notification Delivery), or CP-018/CP-021** — all three
have no remaining dependency once CP-016 closes (see
[`phase-dependency-graph.md`](phase-dependency-graph.md)'s "What can run
in parallel today"). This document does not pick one; that decision is
this phase's own `next-phase-decision.md`'s to make when next
consulted, not silently reassigned here.

## Evidence

Every claim in this document and its linked companions traces to: a
real kill/restart of a local Redis process (four independent rounds —
two for the api readiness endpoint, two each for worker/
notification-worker startup, all with real timestamps and exit codes),
a real `CLIENT PAUSE` against a real Redis proving BullMQ producer/
consumer behavior under a genuine stall, a real fresh-PostgreSQL
migration cycle, two full consecutive e2e suite runs, and a full
`pnpm lint`/`pnpm typecheck`/`pnpm test` run across all 15 workspace
projects — enumerated in full in
[`../architecture/redis-reliability.md`](../architecture/redis-reliability.md)'s
"Live evidence" section.

## Git Branch

`16-feature-platform-reliability`, cut from `develop` at CP-015's final
commit.

## Commit

See this phase's final completion report for the exact final commit
hash.

## Validation Results

| Check                                           | Result                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm validate:structure`                       | Passed                                                                                                                                |
| `pnpm lint`                                     | Passed, 0 errors, 0 warnings, all 15 workspace projects                                                                               |
| `pnpm typecheck`                                | Passed, 0 errors, all 15 workspace projects                                                                                           |
| `pnpm test`                                     | 336/336 passing (api 336 incl. 4 new; worker 3/3 incl. 2 new; notification-worker 4/4 incl. 2 new; all other workspaces cached-clean) |
| `pnpm audit --audit-level high`                 | 1 low, 0 high/critical — pre-existing, no new dependency added by this phase                                                          |
| `pnpm roadmap:audit`                            | See final report                                                                                                                      |
| `prisma migrate status` (fresh DB)              | "Database schema is up to date!" (confirmed)                                                                                          |
| `prisma migrate diff` (fresh DB)                | `-- This is an empty migration.` — zero drift (confirmed)                                                                             |
| Fresh PostgreSQL migration                      | Confirmed, all 11 migrations applied cleanly                                                                                          |
| e2e suite, run 1 of 2                           | 13/15 suites, 200/202 tests (2 pre-existing, non-regression, load-sensitive failures — see above)                                     |
| e2e suite, run 2 of 2                           | 13/15 suites, 200/202 tests (identical result — confirms consistency, not new instability)                                            |
| `redis-reliability.e2e-spec.ts` (new)           | 7/7 passing, both runs                                                                                                                |
| `wait-for-redis.spec.ts` × 3 (new)              | 4+2+2 = 8/8 passing, both runs                                                                                                        |
| Redis startup fail-fast, all 3 services         | Confirmed live, 2 rounds each: `process.exit(1)` at 10-11s, never hangs                                                               |
| Redis startup recovery, all 3 services          | Confirmed live, 2 rounds each: boots on first attempt once Redis is reachable                                                         |
| `GET /health` under Redis outage                | Confirmed live: stays `200` (DB-only, unchanged), 2 rounds                                                                            |
| `GET /health/ready` under Redis outage/recovery | Confirmed live: `503` → `200`, no restart, 2 rounds                                                                                   |
| BullMQ producer/consumer under real Redis stall | Confirmed live: producer blocks (no false success), consumer resumes automatically, no job loss                                       |

This table is completed with the remaining real results in the final
chat report for this phase.
