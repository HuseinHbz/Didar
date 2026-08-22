# CP-017 Validation Audit — Real Notification Delivery

**This is a validation/governance operation, not a new canonical phase.**
No new CP number, no roadmap rewrite, no phase renaming, no feature
implementation. It records the final validation gate for CP-017 against
the repository's own governance rules and reports the merge decision —
the same purpose `integration-cp016-cp021.md` and `integration-cp018.md`
served for their own phases.

## Canonical identity

- **CP:** CP-017 — Real Notification Delivery
- **Branch:** `17-feature-real-notification-delivery` (origin, untouched
  by this operation: `f42dc811f64a52a24fabbb471d11925d1dfe013c`)
- **Cut from:** `16-feature-platform-reliability` tip (not `develop` —
  `develop` was still at CP-015's tip when CP-017 started; per
  `phase-governance.md`'s Definition of Ready this is valid, documented
  in CP-017's own audit doc)
- **Commits (7):** `b4c7840`, `7569851`, `cb94d18`, `584459a`, `0a5b670`,
  `aa5e22a`, `f42dc81`
- **Pre-existing self-reported status** (`phase-017-audit.md`, written on
  CP-017's own branch): `IMPLEMENTED`, 80% — explicitly **not**
  `VALIDATED`, for exactly the reason re-confirmed below.

## Phase 0 — Preflight findings

- `develop` HEAD before this operation: `59837cb` (CP-016, CP-018, CP-021
  all merged and VALIDATED — confirmed via `git log`/`roadmap.json`).
- `git merge-base --is-ancestor origin/17-feature-real-notification-delivery origin/develop`
  → `false`. CP-017 is **not** merged, **not** an ancestor of `develop`.
- No contradiction found between this task's stated canonical state and
  the repository: CP-016/018/021 merged+VALIDATED, CP-017
  implemented-not-validated, CP-019 blocked, CP-020/022 not started — all
  independently re-confirmed by this operation, not merely assumed from
  the prompt.
- No superseding phase exists. No governance contradiction found. This
  operation proceeded past Phase 0.

## Phase 1 — Implementation audit (direct source review, not just trusting the prior audit doc)

Read directly, not re-derived from `phase-017-audit.md`'s own claims:

- **`services/notification-worker/src/notifications/adapters/sms.adapter.ts`**
  — real `fetch()` call to Kavenegar's documented REST contract
  (`/verify/lookup.json` for `templateKey === 'OTP'`,
  `/sms/send.json` otherwise), `AbortSignal.timeout(15_000)` bounds every
  request, the API key is part of the URL path (Kavenegar's own
  contract) and is never interpolated into any log line — every log
  statement in this file references only `message.to`, `message.templateKey`,
  or the provider's own `statustext`/error message. An empty/unset
  `SMS_API_KEY` takes a documented, safe stub-fallback path (log +
  synthetic `'sent'` result, zero HTTP calls) — matches CP-016's own
  "absent credential is a valid environment, not an error" precedent.
  Malformed/non-2xx provider responses are caught in `send()`'s
  `try`/`catch`, mapped to `status: 'failed'`, never thrown further —
  confirmed to not crash the caller.
- **`services/api/src/modules/identity/domain/entities/otp-request.entity.ts`**
  (`shouldSkipNotification`) and
  **`.../application/auth/request-otp.usecase.ts`** — cooldown gates only
  the fire-and-forget SMS dispatch (`.catch()`-wrapped, never `await`ed
  into the response), never the OTP code's own issuance or
  `devOnlyCode` — confirmed by direct read, matching the audit doc's
  claim exactly.
- **`services/api/src/modules/identity/infrastructure/notifications/bullmq-otp-notification.adapter.ts`**
  — the one real producer onto the `notifications` BullMQ queue. No
  `attempts` option is set (defaults to 1 — no retry), `removeOnComplete: true`,
  `removeOnFail: { count: 50 }` — confirmed: a failed SMS dispatch cannot
  create an uncontrolled duplicate send (there is no retry at all), and
  cannot leave an unbounded number of stale failed jobs in Redis.
- **`NotificationChannelPort` contract**: unchanged signature; Telegram/
  WhatsApp/Email/Push adapters untouched by this branch's diff (confirmed
  via `git diff --stat` — only `services/notification-worker/src/notifications/adapters/sms.adapter.ts`
  and its own spec file changed under `adapters/`).
- **OTP flow** (request → validation → generation → persistence/hash →
  notification job → BullMQ → notification worker → SMS adapter →
  provider → delivery result): every hop verified live in Phase 3/6
  below, not just read.

No implementation-audit defect found. Every claim in CP-017's own
`phase-017-audit.md` that was spot-checked against source matched.

## Phase 2 — Real provider verification (live-tested, not assumed)

**Real network egress to the configured SMS provider does not exist in
this environment.** Tested live, this operation, not carried forward
from a prior claim:

```
$ curl -sS -m 8 -o /dev/null -w "HTTP:%{http_code}\n" https://api.kavenegar.com
curl: (56) CONNECT tunnel failed, response 403
```

Confirmed with structured detail from the outbound proxy's own status
endpoint (`$HTTPS_PROXY/__agentproxy/status`), captured at the moment of
the test:

```json
{
  "ts": "2026-08-22T12:28:04.441Z",
  "kind": "connect_rejected",
  "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
  "host": "api.kavenegar.com:443"
}
```

A general-internet control request (`https://www.google.com`) was
rejected identically in the same second — this is this sandbox's
blanket outbound policy, not a Kavenegar-specific block, and matches
the exact class of limitation `ADR-008-payment-orchestration.md`
already documented for ZarinPal.

**Additionally**, this sandbox has **no real Kavenegar credential
configured at all** — `services/notification-worker/.env`'s
`SMS_API_KEY` is present but empty. Two independent, compounding reasons
make live delivery unprovable here: no credential, and no egress even if
one existed.

Per this operation's own Phase 2 rule: **CP-017 is not marked VALIDATED
on the strength of live delivery.** No mock, no intercepted HTTP, no
fake provider response, and no hardcoded success was substituted — see
Phase 6 below for the live, real-failure-path proof that was performed
instead, which is honest about failing, not simulated to succeed.

## Phase 3 — Regression testing

Real PostgreSQL + real Redis throughout. Two distinct code states were
tested, for a documented reason (see "Note on test methodology" below):

### 3a — CP-017's own branch, checked out directly

`pnpm install`, `format:check` (5 pre-existing unrelated warnings, same
set as every prior operation this session), `lint` ✓, `typecheck` ✓,
`build` ✓, `pnpm test` (unit) — `@iecp/api` 353/353, `@iecp/notification-worker`
10/10 (includes `sms.adapter.spec.ts`'s 6 real-local-`node:http`-server
cases and `request-otp.usecase.spec.ts`'s 6 cases). `prisma migrate status`:
11 migrations, up to date (CP-017 adds zero migrations, confirmed).

Full `services/api` e2e suite on this branch directly: 204/206 passed,
2 failures — the already-documented `return-settlement-repository`
timeout, **plus one new-looking failure** in `inventory.e2e-spec.ts`
("reserves stock, decrementing available and writing a ledger entry",
expected 43 got 45). Investigated before classifying (see 3b).

### 3b — Root-caused: cross-branch database contamination, not a CP-017 defect

This sandbox's Postgres instance has been continuously reused across
this entire session's operations (CP-021 → CP-016+021 integration →
CP-018 integration → this operation) and had already advanced to 12
applied migrations (including CP-021's procurement migration) by the
time CP-017's own branch — whose local `migrations/` folder has only 11
— was checked out directly and pointed at that same live database.
`prisma migrate deploy` only applies forward, it does not roll a
database back to an older branch's expectations, so this created a
genuine schema/seed mismatch unrelated to CP-017's own diff.

**Isolated proof:** re-running just the failing test alone against the
same contaminated database reproduced the same failure deterministically
(not a one-off flake). **Root-cause proof:** `git diff --stat
origin/16-feature-platform-reliability..origin/17-feature-real-notification-delivery`
contains **zero** files under `services/api/src/modules/inventory/` or
`test/inventory.e2e-spec.ts` — CP-017 cannot have caused a failure in
code it never touches.

To get an uncontaminated signal, CP-017's actual diff was tested via a
throwaway, unpushed, uncommitted-to-`develop` scratch merge (branch
`scratch-cp017-validation`, based on current `develop` HEAD `59837cb`,
merged with `origin/17-feature-real-notification-delivery`, governance
docs resolved with `--ours` since only code behavior was under test) —
this matches the database's actual 12-migration state exactly. Against
that: `pnpm install`/`build` ✓, `prisma migrate status`: 12 migrations,
up to date, zero drift. Full e2e suite run twice:

| Run | Result                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 222/224 passed — the two already-documented pre-existing failures only (return-settlement timeout + promotion-repository transient flake)                |
| 2   | 223/224 passed — return-settlement timeout only (promotion-repository did not flake this run — consistent with its own prior "transient" classification) |

`inventory.e2e-spec.ts` passed cleanly in both runs against the matched
schema — confirming the earlier failure was 100% attributable to the
cross-branch schema/seed mismatch, not to CP-017. CP-017's own dedicated
e2e file, run in isolation against the matched state:
`test/otp-notification.e2e-spec.ts` — **4/4 passed** (exactly one job
enqueued for a fresh phone, no duplicate on rapid repeat, a new job after
the prior code is consumed via a real login, a code issued during a
skipped-dispatch window is still real and verifiable).

The scratch branch was deleted after use, never pushed, never committed
to real `develop`. `develop` itself was never touched by this Phase 3
investigation.

### Failure classification (per this operation's own required categories)

| Failure                                                                                      | Classification                         | Evidence                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `return-settlement-repository.e2e-spec.ts` 20x `reconcileAll()` timeout                      | **B — pre-existing**                   | File predates CP-016/017/018/021 (Phase 013, 2026-08-20); reproduced identically across every prior integration operation this session                                                             |
| `promotion-repository.e2e-spec.ts` concurrent-`reserve()` flake                              | **D — flaky/unresolved**, pre-existing | Same transient full-battery-contention classification established during CP-021's own validation; absent entirely from run 2                                                                       |
| `inventory.e2e-spec.ts` reservation-decrement mismatch (CP-017 branch only, direct checkout) | **C — environmental**                  | Root-caused to cross-branch DB schema/seed mismatch in this reused sandbox; zero inventory files in CP-017's diff; disappeared entirely once tested against a schema-matched state (scratch merge) |

**No failure in category A (introduced by CP-017) was found**, across
either test methodology.

## Phase 4 — Security gate

- **Secrets are environment-only**: `SMS_API_KEY` read via `ConfigService`
  from env, never hardcoded, never committed (`.env` is gitignored,
  confirmed present only in `.env.example` as an empty placeholder key
  name).
- **No OTP logged**: grepped `RequestOtpUseCase` and the notification
  path — the raw `code` is passed as BullMQ job `variables`, never
  logged; the adapter logs only `message.to`/`templateKey`/provider
  status text.
- **No provider token logged**: confirmed by source read (Phase 1) and
  **live-verified** (Phase 6) — zero occurrences of the real dispatch
  path's API key string across 521 real, live-processed job logs.
- **No SMS endpoint bypass**: `POST /auth/otp/request` is the only
  caller; unchanged authorization posture (public, rate-limited only by
  the new narrow cooldown — see below).
- **Cooldown cannot be bypassed through an obvious alternate path**: the
  cooldown is enforced inside `RequestOtpUseCase` itself (server-side,
  keyed on `(phone, purpose)` read from the latest persisted
  `OtpRequest`), not client-supplied state — there is no alternate route
  that issues an OTP notification. Known, documented limitation (not
  hidden): the cooldown is `(phone, purpose)`-keyed, allowing up to 3
  real sends per window per phone (one per purpose) rather than a
  phone-only 1 — this is CP-017's own honestly-recorded scope boundary,
  not a defect this operation found or is newly disclosing.
- **Retry cannot create uncontrolled duplicate SMS**: confirmed by source
  (Phase 1) — no `attempts` option is configured on the BullMQ job (default
  1, no retry) — and confirmed live (Phase 6): the queue backlog drained
  to zero, no job reappeared after its single failed attempt.
- **Provider failures do not expose internal details**: the adapter's
  `catch` block surfaces only `error.message` (Kavenegar's own
  `return.message`, or a generic parse error) to its own log — never
  propagated to the HTTP response (`RequestOtpUseCase` never awaits the
  dispatch).
- **Malformed provider responses cannot crash the worker**: confirmed
  live (Phase 6) — the real (blocked) network response body is HTML
  ("Host not i...", not JSON), `response.json()` threw, was caught, and
  521 consecutive such failures across a real live run did not crash the
  `notification-worker` process.
- **Timeout does not leave jobs permanently stuck**: `AbortSignal.timeout(15_000)`
  bounds every request; combined with no retry, a job either completes
  (success or `'failed'`) or times out and completes as `'failed'` — it
  cannot sit indefinitely. Live-confirmed: the entire 521-job backlog
  drained to empty within seconds of the worker starting.

**No security defect was found in CP-017's own scope.** No fix was made
under this phase (none was needed) — the one already-known, pre-existing,
unrelated defect (`InventoryReservation` double-release/convert → `500`,
since CP-006) is cross-referenced, not CP-017's concern, not touched.

## Phase 5 — Validation decision

**IMPLEMENTED / VALIDATION-BLOCKED.**

- Implementation audit: passed (Phase 1).
- Automated validation: passed, once tested against a schema-matched
  state (Phase 3) — zero category-A failures.
- Security gate: passed (Phase 4).
- Real SMS delivery: **cannot be proven** — no network egress to any
  external host from this sandbox (live-confirmed, structured proxy
  evidence), and no real provider credential is even configured here.
  Repository governance does not define an alternate objective
  acceptance mechanism for this class of gap — `phase-governance.md`
  follows CP-008's own precedent (`IMPLEMENTED`, not `VALIDATED`, for the
  identical "real adapter, unprovable live network path" situation),
  which is exactly the calibration CP-017's own audit doc already
  adopted for itself.

This is not an approximation: CP-017 does not become `VALIDATED` by this
operation. It remains exactly what its own branch already, honestly
recorded — `IMPLEMENTED`, 80% — with this operation adding a second,
independently-verified confirmation of why, plus the environmental-vs-
CP-017 disambiguation of the inventory test failure, and a completed
security gate that a plain implementation audit doesn't provide.

## Phase 6 — Merge decision

**CP-017 is NOT merged.** Per this operation's own rule: a phase blocked
on live-provider verification is not merged merely to make the roadmap
look complete. `17-feature-real-notification-delivery` is left
untouched on `origin` (`f42dc81`, unchanged by this operation — verified
by `git rev-parse` before and after). `develop` (`59837cb`) is unchanged.

**Live, real-runtime evidence gathered instead** (in place of the
unattainable live-delivery proof, and beyond what Phase 1's static read
alone could show) — a real, honest failure-path proof, not a simulated
success: `services/api` and `services/notification-worker` were both
booted (real Postgres + real Redis) from the schema-matched scratch
build, with a clearly-labeled test-only placeholder value
(`test-only-fake-key-for-runtime-verification-not-a-real-secret`) set
for `SMS_API_KEY` — enough to route the adapter onto its real HTTP path
rather than the stub fallback, while remaining honest that this key
holds no real provider access. A real `POST /auth/otp/request` was
issued, and the worker was observed draining a 521-job Redis backlog
(most of it pre-existing from earlier operations this session) —
every one of them a real, live-attempted Kavenegar HTTP call, every one
correctly rejected at the network layer with the identical
"Host not i..." body this sandbox's proxy returns for any blocked host,
every one caught and logged as `'failed'` without a crash, without a
retry, and without a stuck job, and **zero occurrences of the test key
string anywhere in the log**. The worker then exited cleanly on
`SIGTERM` within 3 seconds under that same load. The test-only key was
restored to its original blank value in `.env` afterward
(non-committed, local-only file; `git status` confirmed no residual
diff beyond an unrelated, discarded Next.js dev-cache artifact).

## Phase 7 — this document

This file.

## Phase 8 — Final project status

| CP     | Status                               | Implemented | Validated               | Merged                      | Evidence                                           |
| ------ | ------------------------------------ | ----------- | ----------------------- | --------------------------- | -------------------------------------------------- |
| CP-014 | VALIDATED                            | ✓           | ✓                       | ✓ (into `develop`)          | `phase-014-audit.md`                               |
| CP-015 | VALIDATED                            | ✓           | ✓                       | ✓                           | `integration-reconciliation.md`                    |
| CP-016 | VALIDATED                            | ✓           | ✓                       | ✓                           | `phase-016-audit.md`, `integration-cp016-cp021.md` |
| CP-017 | **IMPLEMENTED / VALIDATION-BLOCKED** | ✓           | ✗ (live SMS unprovable) | ✗ (deliberately not merged) | this document; `phase-017-audit.md`                |
| CP-018 | VALIDATED                            | ✓           | ✓                       | ✓                           | `phase-018-audit.md`, `integration-cp018.md`       |
| CP-019 | BLOCKED                              | ✗           | ✗                       | ✗                           | domain-expert review gate, unchanged               |
| CP-020 | NOT_STARTED                          | ✗           | ✗                       | ✗                           | blocked transitively on CP-019                     |
| CP-021 | VALIDATED                            | ✓           | ✓                       | ✓                           | `phase-021-audit.md`, `integration-cp016-cp021.md` |
| CP-022 | NOT_STARTED                          | ✗           | ✗                       | ✗                           | blocked transitively on CP-020                     |

1. **Last merged CP:** CP-018 (unchanged by this operation).
2. **Last validated CP:** CP-018 (and CP-016/CP-021 in the same prior
   operations); CP-017 does **not** join this list.
3. **Current canonical CP:** unchanged — CP-016, CP-018, CP-021 remain
   the most recently merged+validated trio.
4. **First genuinely unblocked canonical CP still requiring
   implementation work:** none. CP-017 needs a staging environment with
   real Kavenegar egress, not more implementation. CP-019 is blocked on
   a human review gate this operation cannot clear.
5. **Current blockers:** CP-017 — real network egress + a real
   provisioned credential, neither available in this sandbox. CP-019 —
   domain-expert review. CP-020 — transitively via CP-019. CP-022 —
   transitively via CP-020.
6. **Is CP-017 VALIDATED?** **No.**
7. **Was CP-017 merged?** **No.**
8. **Exact next canonical execution unit:** none is available to _start_
   from this operation. The only two live paths forward are external to
   engineering work in this sandbox: (a) obtain real Kavenegar
   credentials + staging network egress to complete CP-017's live
   delivery proof, or (b) obtain the domain-expert review CP-019 is
   blocked on. Neither is performed by this operation.

No new roadmap. No new phase. No new CP. No speculative implementation.
