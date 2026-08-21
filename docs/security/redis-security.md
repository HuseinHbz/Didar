# Redis security (CP-016)

This document is `docs/security/README.md`'s service-wide security
posture, expanded for the one dependency CP-016 hardened the
availability of. Companion to
[`../architecture/redis-reliability.md`](../architecture/redis-reliability.md)
(full architecture/defect account) and
[`../operations/redis-failure-runbook.md`](../operations/redis-failure-runbook.md).

## Threat model: what Redis can and cannot affect

Redis in this system holds **only BullMQ job-scheduling state** — never
sessions, never cached authorization decisions, never business data (see
the architecture doc's "one rule that governs everything"). Concretely,
this means:

- A compromised or fully-unavailable Redis **cannot** grant an attacker
  authentication, authorization, or access to business data — none of
  that ever lives in Redis. Confirmed by the same grep sweep the
  architecture doc describes: zero direct `ioredis`/`createClient` usage
  outside `BullModule` registrations.
- A compromised Redis **could** let an attacker with write access to it
  enqueue or tamper with job payloads for the queues it holds (e.g.
  forge a `low_stock_notification` or `invoice_generation` job). Every
  processor that consumes these jobs re-validates its own inputs and
  re-derives state from PostgreSQL rather than trusting job payloads as
  authoritative — this was already true before CP-016 and is unchanged
  by it, but is the actual mitigating control if this document's threat
  ever materializes.
- A fully-unavailable Redis is an **availability** incident, not a
  **confidentiality/integrity** one — see the failure runbook.

## Credential handling (what CP-016 added, specifically)

Every new piece of code this phase introduced that touches `REDIS_URL`
(`src/bootstrap/wait-for-redis.ts` in all three services, plus
`HealthController.checkRedis()` in `services/api`) follows the same rule,
enforced by code review at write-time and now pinned by comments at each
call site: **log only the resolved `host`/`port`, never the raw
`REDIS_URL` or anything derived from `url.toString()`.** This matters
because `REDIS_URL` can carry credentials in `redis://user:pass@host:port`
form — logging the raw string would leak them into CI logs, application
logs, and (for the readiness endpoint) potentially into an HTTP response
body served to whatever's polling it.

Verified live, not just by inspection: the `redis-reliability.e2e-spec.ts`
"no credential/URL leakage" assertion checks the actual JSON response
body of a real `503` from `GET /health/ready` against the real
`REDIS_URL` value the test run was booted with, and the manual live
proofs in the architecture doc's "Live evidence" section show the actual
log lines produced against a real unreachable Redis — in both cases, only
`host:port` appears, never a credential.

## `GET /health/ready`'s own exposure

The new readiness endpoint is `@Public()` (no auth), same as the
pre-existing `GET /health` — intentional and unchanged reasoning: both
must stay reachable by a load balancer / orchestrator even when
everything else (including the identity module's own dependencies) is
unhealthy, which rules out requiring a JWT to read them. This is a
standard, narrow trade-off for liveness/readiness endpoints, and the
response body is deliberately minimal: `up`/`down` status per dependency
and, on failure, the OS-level connection error message only (never a
stack trace, never internal configuration beyond host/port, never a
credential — see above). An attacker who can already reach this endpoint
learns only "is this instance's Postgres/Redis currently reachable,"
which is not materially more than what response-time/5xx-rate
fingerprinting from any public endpoint would already reveal.

## CI Redis service container

`redis:7.4-alpine` in `.github/workflows/ci.yml` runs with no
authentication (`requirepass` unset) and no TLS, on the default port,
scoped to the ephemeral CI runner's own network namespace only — never
reachable from outside that single job run, and destroyed with the
runner at the end of the job. This matches the same posture the
pre-existing `postgres:17-alpine` CI service already had (see
[`ci-pipeline.md`](../deployment/ci-pipeline.md)) and is standard practice
for disposable CI-only service containers; it is not a template for how
a production Redis instance should be configured (see the failure
runbook's note that production Redis HA/auth/TLS configuration is
explicitly out of this phase's scope, owned by whoever operates that
instance).

## What this phase does not add

- No new Redis ACL/authentication scheme — none was needed; the fix is
  entirely about availability behavior, not access control.
- No TLS between application services and Redis — unchanged from before
  this phase; if the production Redis instance requires TLS, that is a
  `REDIS_URL` scheme/connection-option concern for deployment
  configuration, not something CP-016's bootstrap code needs to know
  about (the raw-socket preflight check and BullMQ's own client both
  already respect whatever `REDIS_URL` specifies).
- No secrets were committed anywhere in this phase's changes — confirmed
  as part of the validation gate (see `docs/product/phase-016-audit.md`).
