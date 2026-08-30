# Phase 017 Audit (CP-017 — Real Notification Delivery)

Required audit output for CP-017, matching the shape
[`phase-016-audit.md`](phase-016-audit.md) established. Full evidence:
[`../adr/ADR-014-real-notification-delivery.md`](../adr/ADR-014-real-notification-delivery.md)
and its product/security companions.

## Overall Project Progress

Per [`project-progress.md`](project-progress.md) and `roadmap.json`'s
`aggregate`: **18 of 30 canonical phases Completed, 0 Partial, 0 in
progress, 12 Planned.** CP-017 moved from Planned to Completed as a
direct result of this phase — the only status transition on this phase's
own scope.

## Completed Phases

CP-000 through CP-017 (18 phases). CP-017 newly reached `IMPLEMENTED`
status in this phase — not `VALIDATED`, matching the exact precedent
CP-008 already established for a real-provider adapter with an
unverified live-network path (`canonical-roadmap.md`'s own CP-008 entry:
`IMPLEMENTED`, 75%, blocking issue "live network path never verified").
CP-017 sits at 80% for the same class of reason — see "Known
Limitations" below.

## Partial Phases

None.

## Planned Phases

CP-018 through CP-029 (12 phases), unchanged by this phase's own scope.

## Roadmap Divergence — conflicts found and resolved (Phase 1/2 of this phase's own kickoff)

Three conflicts between `master-roadmap-v2.md`'s `P017` definition and
the actual repository state, resolved (not silently picked) before any
code was written — full account in ADR-014's own "Context" section:

1. **Network egress** — `P017` assumes real network egress to a
   provider; this sandbox's outbound proxy denies it (confirmed live,
   identical to ADR-008's ZarinPal precedent). Resolved: real, documented
   Kavenegar REST contract implemented; live verification is a staging
   gap, not faked.
2. **Observability** — `P017` assumes "P016's metrics wiring"; CP-016
   never delivered that (deferred to CP-029). Resolved: structured logs
   only, matching CP-016's own actual delivered scope.
3. **Abuse safety** — CP-017's own dependency on CP-016 was partly
   reasoned on rate-limiting minimums CP-016 explicitly never delivered
   (confirmed live: zero throttling on `POST /auth/otp/request` before
   this phase). Resolved: a narrow, in-scope `(phone, purpose)` SMS-
   dispatch cooldown — not the broader P1-1, which stays deferred.

No silent divergence from the canonical roadmap's own gap ownership —
`gap-priority-matrix.md`'s P1-2 (`CP-017`) is resolved by this phase
exactly as assigned; P1-1 (`CP-017 or later`) is _not_ claimed resolved,
only partially and narrowly mitigated, and is documented as such.

## P0/P1 Gaps

| ID   | Gap                                          | Status after CP-017                                                                                                                                                                                                                     |
| ---- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-2 | Every notification-channel adapter is a stub | **RESOLVED** for SMS (real Kavenegar integration) — Telegram/WhatsApp/Email/Push remain stubs, explicitly out of this phase's own scope, unchanged                                                                                      |
| P1-1 | No rate limiting anywhere in `services/api`  | Still open — **partially, narrowly mitigated** for the one endpoint this phase made cost-sensitive (`POST /auth/otp/request`'s SMS dispatch); every other endpoint remains unthrottled; full repo-wide fix remains a future phase's job |

Full table: [`gap-priority-matrix.md`](gap-priority-matrix.md).

## Architecture Changes

- `services/notification-worker/src/notifications/adapters/sms.adapter.ts`
  — stub replaced with a real Kavenegar REST integration (`ConfigService`-
  injected, two real endpoints selected by `templateKey`, config-driven
  fallback to the exact pre-CP-017 stub when `SMS_API_KEY` is unset).
- `services/api/src/modules/identity/domain/entities/otp-request.entity.ts`
  — new `OtpRequest.shouldSkipNotification()` pure domain method.
- `services/api/src/modules/identity/domain/ports/otp-notification.port.ts`
  (new), `infrastructure/notifications/bullmq-otp-notification.adapter.ts`
  (new), `infrastructure/queues/identity-notification-queue.module.ts`
  (new) — `services/api` is now a producer onto the `notifications`
  BullMQ queue `services/notification-worker` consumes (previously,
  nothing in `services/api` ever enqueued onto it — confirmed by grep
  before this phase started).
- `RequestOtpUseCase` — extended (fire-and-forget SMS dispatch after the
  existing `OtpRequest` creation, cooldown-gated), `devOnlyCode`/response
  contract otherwise byte-identical to before this phase.

## Database Changes

None. `database_requirements: []` in `master-roadmap-v2.md`'s own `P017`
definition, confirmed accurate — no migration in this phase. Fresh-
database migration re-verification (unchanged schema) still run as part
of this phase's own validation gate — see below.

## API Changes

No new routes, no changed request/response schemas.
`POST /auth/otp/request`'s response shape (`{ expiresAt, devOnlyCode }`)
is unchanged; only its side effects changed (a real SMS dispatch is now
attempted, subject to the new cooldown).

## Security Changes

Full account: [`../security/notification-security.md`](../security/notification-security.md).
Summary: no new auth/authorization surface, no new IDOR surface, real
credential-handling verified by a live test assertion (API key never
appears in a logged/loggable body), OTP-code-in-Redis-at-rest exposure
bounded via job retention options (`removeOnComplete: true`,
`removeOnFail: { count: 50 }`, no retry), and the one honestly-documented
remaining gap (cooldown is `(phone, purpose)`-keyed, not phone-only).

## Tests

- **Unit — `sms.adapter.spec.ts`** (6 cases): real local `node:http`
  server standing in for Kavenegar (never `jest.mock` of `fetch`) — stub
  fallback with no HTTP call, real Verify-Lookup request shape (including
  the "API key never in the body" assertion), real generic-send request
  shape, delivery-failure-status mapping, API-error mapping, `getStatus`
  round-trip.
- **Unit — `otp-request.spec.ts`** (11 cases): `isUsable` (4 cases,
  pre-existing behavior pinned) + `shouldSkipNotification` (7 new cases —
  no-prior, consumed-prior, expired-prior, attempts-exhausted-prior,
  within-cooldown, past-cooldown, zero-cooldown).
- **Unit — `request-otp.usecase.spec.ts`** (6 cases, hand-rolled fakes,
  same "no NestJS module, no DB, no HTTP" precedent
  `get-user-by-id.usecase.spec.ts` established): code always issued;
  `devOnlyCode` null in production; dispatch on first request; dispatch
  skipped within cooldown while the code is still issued; dispatch
  resumes once the prior request is consumed; a dispatch failure never
  fails the use case's own response.
- **e2e — `otp-notification.e2e-spec.ts`** (4 cases, real Redis, real
  BullMQ `Queue` inspection via delta-based job counting, real HTTP via
  the real `AppModule`): exactly one job enqueued for a fresh phone; no
  second job for a rapid repeat; a job enqueued again once the prior code
  is consumed via a real login; a code issued during a skipped-dispatch
  window is still real and verifiable.

## Failure-Injection / Concurrency Evidence

Not applicable in the sense CP-013/CP-016 used the term (no new
state-machine/financial-concurrency surface, no new infrastructure
dependency) — the closest analogue, a producer-side failure of the new
notification dispatch, is covered directly by
`request-otp.usecase.spec.ts`'s dedicated "a notification dispatch
failure never fails or delays the use case response" case (fakes a
rejected `sendOtpSms()` call, asserts the use case's own promise still
resolves normally).

## CI Evidence

Full repo-wide gate run — see "Validation Results" below.

## Documentation Changes

`docs/adr/ADR-014-real-notification-delivery.md` (new),
`docs/product/notifications.md` (new),
`docs/security/notification-security.md` (new),
`services/notification-worker/README.md` (updated — SMS no longer listed
as a stub), `services/api/src/modules/identity/README.md` (updated — OTP
delivery section rewritten, new env var documented),
`services/api/.env.example` /
`services/notification-worker/.env.example` (new env vars documented),
this file, plus the roadmap-governance files listed below.

## Known Limitations

- The `(phone, purpose)`-keyed cooldown allows up to 3 real SMS sends per
  window per phone (one per purpose) rather than 1 — documented, not
  hidden, in ADR-014/notification-security.md; full fix is P1-1's.
- Live end-to-end delivery against the real Kavenegar API is unverified
  from this sandbox (outbound egress denied) — a staging-environment gap,
  same class as ADR-008's own ZarinPal precedent.
- The generic (non-OTP) SMS send path is real and unit-tested but has no
  real caller yet — a future phase's job to wire (e.g. order
  confirmation).
- Telegram/WhatsApp/Email/Push remain stubs, unchanged, by design.

## Remaining Risks

None new beyond the known limitations above. No regression found in the
full e2e suite (see below) — the 12 pre-existing e2e files that call
`POST /auth/otp/request` all pass unchanged, twice consecutively under
`--runInBand`.

One new observation from this phase's own validation-gate run, reported
honestly rather than dismissed: a single **default-parallel-worker** e2e
run (Jest's normal multi-process mode, not `--runInBand`) showed 10
additional failures, all `401` at `loginByPhone` inside
`return-settlement-repository.e2e-spec.ts`. Investigated before being
classified: `RequestOtpUseCase` always creates a fresh `OtpRequest` and
returns its real code via `devOnlyCode` regardless of the new cooldown
logic (verified by reading the code path — cooldown only ever gates the
fire-and-forget SMS dispatch, never issuance or `devOnlyCode`), so the
401s cannot come from a wrong code. Two consecutive `--runInBand` runs
(serial, no cross-file contention) reproduced only the single
already-documented `reconcileAll() 20x` timeout and nothing else — same
result both times. This isolates the 10 extra failures to cross-file
resource contention against the shared real Postgres/Redis under full
parallelism (this sandbox's already-documented load sensitivity, see
CP-015/CP-016 audits), not to any CP-017 code path. Classified as
**environment failure**, not a regression. Still worth tracking: this
sandbox's parallel-worker headroom has visibly shrunk as more BullMQ
queues/Redis connections were added across CP-016 and CP-017 — a future
phase should consider whether `services/api`'s e2e Jest config should
default to serial execution rather than relying on operators to pass
`--runInBand` by hand.

## Roadmap Impact

CP-017 -> `IMPLEMENTED`, 80% (same "real adapter, unverified live network
path" calibration as CP-008). P1-2 -> `RESOLVED` (SMS only, as scoped).
New gap **P1-8** ("Live Kavenegar SMS gateway network path never
verified") added, owned by CP-017's own remainder, mirroring P1-6's
existing ZarinPal entry exactly. P1-1 remains open, narrowly and
honestly annotated as partially mitigated for one endpoint. No other
phase's status changes.

## Acceptance Criteria Matrix (per `master-roadmap-v2.md`'s own `P017`)

| Criterion                                                                  | Result                                                                                                                                                                 |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One real `SmsAdapter` implementation behind the existing port              | Met                                                                                                                                                                    |
| Provider credentials via existing secret-management convention             | Met (`SMS_API_KEY`, already-reserved env slot)                                                                                                                         |
| Telegram/WhatsApp/Email/Push remain stubs, no scope-creep                  | Met                                                                                                                                                                    |
| A real OTP request results in a real SMS in staging with real egress       | **Partially met** — implemented against the real documented contract; live verification blocked by this sandbox's proxy policy, same as ADR-008's precedent, not faked |
| `NotificationDispatcherService` fallback logic requires zero changes       | Met — confirmed by the pre-existing `notification-dispatcher.service.spec.ts` passing unchanged                                                                        |
| Provider API credentials never logged, never committed                     | Met — verified by a live test assertion, not just a claim                                                                                                              |
| Provider adapter tested against a sandbox/test credential or contract test | Met — real local HTTP server, real request/response parsing exercised                                                                                                  |
| Delivery success/failure rate visible (originally: "via P016's metrics")   | **Adjusted** — via structured logs (P016 never delivered metrics wiring; documented conflict, resolved)                                                                |
| Documentation updated from "stub" to "real"                                | Met                                                                                                                                                                    |
| Rollback is a single DI binding change / trivial                           | Exceeded — rollback is simply unsetting `SMS_API_KEY`, no code/DI change needed at all                                                                                 |

## Definition of Done

Per `phase-governance.md`: Implementation (real code, matches acceptance
criteria above) — met. Test (domain unit + application unit + e2e,
including negative/failure cases) — met. Integration — **on this phase's
own branch**, `17-feature-real-notification-delivery`, cut from
`16-feature-platform-reliability`'s tip (see "Roadmap Governance" below
for why `develop` itself was not the parent, and why merging CP-016/017
into `develop` is out of this phase's own scope). Documentation — met
(ADR, product doc, security doc, module READMEs,
`project-progress.md`). Audit — this document.

## Git Branch

`17-feature-real-notification-delivery`, cut from
`16-feature-platform-reliability` (not `develop` — `develop` was still at
CP-015's tip when this phase started, CP-016 not yet merged into it; per
`phase-governance.md`'s Definition of Ready, a dependency only needs to
be at least `IMPLEMENTED`, which CP-016 exceeded — documented, not a
silent choice).

## Final Commit

See this phase's final completion report for the exact final commit
hash.

## Validation Results

| Check                                               | Result                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm validate:structure`                           | Passed — 14 workspaces, 5 infra dirs, 5 doc dirs, 9 root files                                                                                                                                                                                                                                                                                                                                          |
| `pnpm format:check`                                 | Passed for all CP-017 files (9 fixed via `prettier --write`); 5 unrelated pre-existing warnings remain (`next-env.d.ts` x3, `docs/api/payment.md`, `docs/security/payment-security.md` — none touched by this phase)                                                                                                                                                                                    |
| `pnpm lint`                                         | Passed repo-wide, 0 errors/warnings, 15/15 workspaces                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm typecheck`                                    | Passed repo-wide, 0 errors, 15/15 workspaces                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm build`                                        | Passed repo-wide, 11/11 tasks                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm test` (unit, repo-wide)                       | Passed — api 353/353 (52 suites, incl. 17 new), notification-worker 10/10 (incl. 6 new), worker 3/3, scheduler 1/1 — 0 failures                                                                                                                                                                                                                                                                         |
| `pnpm audit --audit-level high`                     | Exit 0 — 1 low-severity advisory only (pre-existing, no lockfile change this phase)                                                                                                                                                                                                                                                                                                                     |
| `pnpm roadmap:audit`                                | Clean — no structural problems; CP-017 = IMPLEMENTED, branch=true; migration status UP_TO_DATE                                                                                                                                                                                                                                                                                                          |
| Fresh-PostgreSQL migration (no schema change)       | All 11 existing migrations applied cleanly to a genuinely fresh DB (`iecp_fresh_check`); `migrate status` = up to date; `migrate diff` = no difference detected                                                                                                                                                                                                                                         |
| e2e suite, run 1 of 2 (`--runInBand`)               | 205/206 passing — 1 pre-existing non-regression failure (`reconcileAll() 20x` timeout in `return-settlement-repository.e2e-spec.ts`, same finding CP-015/CP-016 already documented)                                                                                                                                                                                                                     |
| e2e suite, run 2 of 2 (`--runInBand`)               | 205/206 passing, identical result — confirms consistency, no flip-flopping                                                                                                                                                                                                                                                                                                                              |
| e2e suite, default parallel workers (observational) | 196/206 passing on one parallel run — 10 additional failures, all `401` at `loginByPhone` in the same settlement spec, traced to cross-file sandbox resource contention under full parallelism, not to CP-017 code; disappeared entirely under `--runInBand` on two consecutive runs, so classified as **environment failure** (sandbox load sensitivity), not a regression — see Known Remaining Risks |
| `otp-notification.e2e-spec.ts` (new, real Redis)    | 4/4 passing, both `--runInBand` runs                                                                                                                                                                                                                                                                                                                                                                    |

All rows are real, final results from this phase's own validation gate
run (2026-08-21), not placeholders.

## Follow-up hardening pass (2026-08-30)

A later operation re-audited CP-017 directly against its own source
(never relying only on this document or `phase-017-validation-audit`'s
prior conclusions), per that operation's own instruction to inspect the
actual implementation before trusting any prior write-up. Findings:

- **Real, previously-untested gaps closed** in
  `sms.adapter.spec.ts` (3 new cases, real infrastructure, no mocks —
  same convention this file's existing tests already use): a malformed
  (non-JSON) provider response, a real request timeout against a
  hanging local server (bounded by the adapter's own 15s
  `AbortSignal.timeout`), and credential redaction specifically on the
  network-failure path (not just the success path the original tests
  covered).
- **One real bug found and fixed** while writing the timeout/malformed
  tests: `SmsAdapter`'s catch block used a bare `error instanceof Error`
  check to extract a log message, which silently degraded to the
  uninformative literal `'unknown error'` for a genuine `Error` whose
  constructor crosses a realm boundary from this module's own — observed
  reproducibly for both the malformed-response `SyntaxError` and the
  timeout `TypeError` under this repo's own Jest sandboxing, the same
  class of gap a `vm`-isolated host or a future runtime change could hit
  in production. Fixed with a defensive `messageOf()` helper (duck-types
  a `.message` string when `instanceof` fails, still falls back to
  `'unknown error'` only when nothing message-shaped exists) — never a
  security regression either way, since the fallback is strictly less
  informative, never more; confirmed no leak in both directions with a
  live re-run (see below). Full before/after log evidence: the same two
  test cases logged `"unknown error"` before the fix and
  `"Unexpected token '<'..."` / `"The operation was aborted due to
timeout"` after it.
- **New automated coverage** for two things this phase's original
  audit only verified once, by hand: `notification.processor.spec.ts`
  (pass-through/failure-propagation unit coverage for the one seam
  BullMQ itself reads — a resolved value completes a job, a rejection
  fails it) and `notification-worker.e2e.spec.ts` (real Redis, real
  `AppModule`, real BullMQ `Worker` — job completion, a malformed job's
  failure not wedging the worker for the next job, bounded failed-job
  retention actually pruning old entries past its configured count, and
  a bounded, non-hanging `enableShutdownHooks()` shutdown). This is the
  automated version of the one-time manual "drained a 521-job real
  backlog, clean shutdown" proof this phase's own audit already
  performed by hand once.
- **Live re-confirmation, this operation's own run**: `SMS_API_KEY` set
  to a non-real sandbox value, `services/api` and
  `services/notification-worker` both booted from a real build, a real
  `POST /auth/otp/request` issued end-to-end. The worker took the real
  Kavenegar `/verify/lookup.json` path, the sandbox's outbound proxy
  denied it exactly as previously documented (HTML "Host not i[n
  allowlist]" body, not JSON), the sandbox test value never appeared in
  any log line, and OTP issuance still succeeded regardless (fire-and-
  forget dispatch, unchanged). Same conclusion as this phase's original
  audit and `phase-017-validation-audit`'s later re-confirmation — a
  third independent live reproduction, not a re-statement.
- **Full validation gate re-run, this branch**: `validate:structure` ✓ ·
  `format:check` — 2 files fixed (the new/edited spec files), 5
  unrelated pre-existing warnings untouched (`next-env.d.ts` × 3,
  `docs/api/payment.md`, `docs/security/payment-security.md`) · `lint`
  15/15 workspaces clean · `typecheck` 15/15 clean (one stale `.next`
  build-cache artifact from a prior, unrelated branch checkout in this
  same sandbox caused a transient `apps/admin` failure, resolved by
  clearing `.next/` — environment, not code) · `build` 11/11 · `pnpm
test` (api) 353/353, (notification-worker) 19/19 (was 9 before this
  pass) · `pnpm audit --audit-level high` exit 0, 1 pre-existing low
  advisory · `pnpm roadmap:audit` clean, no structural problems ·
  migration status `UP_TO_DATE` against this branch's 11 migrations ·
  e2e suite (`--runInBand`, ×2 consecutive) 205/206 both runs, identical
  single pre-existing failure (`reconcileAll() 20x` timeout in
  `return-settlement-repository.e2e-spec.ts` — same finding this
  document's own table already carries) · `services/api` and
  `services/notification-worker` both booted from a real build, real
  `/health`/`/health/ready` returned `"status":"ok"`, both shut down
  gracefully on `SIGTERM` (~2.1s and ~1.3s respectively, no force-kill).

**Conclusion — no status change.** CP-017 remains `IMPLEMENTED`, 80%,
blocked only by **P1-8** (live Kavenegar network path unverified) —
Testing was already scored 100/100 in `project-progress.md` before this
pass (deeper coverage doesn't raise a dimension already at its ceiling),
and Security's existing 90/100 already accounted for credential handling
being live-verified. This pass closes real test-coverage and
observability gaps without changing the phase's completion percentage,
status, or blocking-issue list — and does not touch CP-018/019/020/021's
own status, and does not move CP-019's Q1–Q5 off `PENDING`.
