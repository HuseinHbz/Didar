# ADR-014: Real Notification Delivery (CP-017)

## Status

Accepted.

## Context

`services/notification-worker`'s `SmsAdapter` has been a stub since its own
inception — `send()` logs and returns a synthetic "sent" result, no real
provider is called. Every phase from CP-008 onward explicitly deferred
wiring one, tracked as gap **P1-2** (`gap-priority-matrix.md`), owned by
**CP-017** since CP-014's own roadmap reconciliation. `master-roadmap-v2.md`'s
`P017` definition scopes this precisely: replace the SMS stub with one real
Iranian SMS provider integration, keep `NotificationChannelPort` unchanged,
leave Telegram/WhatsApp/Email/Push as stubs — do not scope-creep into all
six channels at once.

### Three conflicts found between that definition and the actual repository state

CP-017's own kickoff process (see `docs/product/phase-017-audit.md`'s
"Roadmap Divergence" section) required resolving these before implementation,
not silently picking an interpretation:

1. **Network egress.** `P017`'s acceptance criteria assumes "a real SMS
   delivered to a real Iranian number... with real network egress." Verified
   live: this sandbox's outbound proxy returns `403` on `CONNECT` to both
   `api.kavenegar.com` and `api.ghasedak.me` — identical to CP-008's own
   confirmed ZarinPal precedent (`services/api/src/modules/payment/README.md`).
   **Resolution:** implement against Kavenegar's real, documented REST
   contract, exactly the way `ZarinpalAdapter` was built (ADR-008 decision 5) — live end-to-end verification is a documented staging gap, not
   faked.
2. **Observability.** `P017` assumes "delivery success/failure rate visible
   via P016's metrics wiring." CP-016 explicitly deferred full
   metrics/`/metrics` exposure to CP-029, delivering only structured-logging
   minimums (`docs/product/phase-016-audit.md`). **Resolution:** delivery
   success/failure surfaces via structured logs (the same CP-016 precedent),
   not a `/metrics` endpoint that does not exist yet.
3. **Abuse safety.** `phase-dependency-graph.md` names rate limiting as a
   reason CP-017 depends on CP-016 — but CP-016 explicitly deferred all of
   P1-1 (confirmed live: `POST /auth/otp/request` has zero throttling —
   `@Public()`, no cooldown, verified by reading `RequestOtpUseCase` and
   `AuthController` directly before writing any code). Wiring a real,
   cost-incurring SMS send onto that exact endpoint would be a live
   security/cost regression. **Resolution — in scope, narrowly:** a
   per-`(phone, purpose)` cooldown on SMS _dispatch_ only (never code
   _issuance_ — see "Decision 2" below). This is **not** the broader P1-1
   (a repo-wide `ThrottlerModule`), which stays explicitly deferred, matching
   this repo's own precedent of a phase fixing only what its own deliverable
   directly necessitates (Phase 007/008/009/010's own found-bug-fixed-in-scope
   pattern, not new unrelated feature work).

## Decision 1 — Kavenegar, via its purpose-built Verify-Lookup endpoint for OTP

Kavenegar (https://kavenegar.com/rest.html) is Iran's most widely documented
SMS gateway and the one `master-roadmap-v2.md` itself names first. Its API
offers two relevant endpoints:

- `/verify/lookup.json` — takes a `token` (the code) and a pre-registered
  `template` _name_ (content configured in Kavenegar's own panel, never in
  this codebase), purpose-built for OTP/verification codes.
- `/sms/send.json` — generic message send.

`SmsAdapter.send()` routes on `NotificationMessage.templateKey`:
`'OTP'` → Verify-Lookup, everything else → generic send. No caller wires the
generic path yet (CP-017's own scope is OTP only) — kept real and
functional rather than throwing, so the port's contract stays honest for
whichever future phase adds the next real caller (e.g. order confirmation
SMS), matching `NotificationChannelPort`'s own existing shape (unchanged by
this phase, per `P017`'s acceptance criteria).

Unset/empty `SMS_API_KEY` is a deliberate, safe fallback to the exact
pre-CP-017 stub behavior — every environment that hasn't configured a real
Kavenegar account (local dev, CI, this sandbox) keeps working unchanged, with
zero regression to any existing test.

## Decision 2 — throttle SMS dispatch, never OTP code issuance

`OtpRequest` only ever persists a code's **hash**
(`OTP_REPOSITORY.create({ codeHash, ... })`) — the raw code is never
retained anywhere retrievable after generation. This makes a "reuse the
previous code on a rapid repeat request" design impossible without either
(a) storing the raw code somewhere (a real security regression) or (b)
returning `devOnlyCode: null` on a path that today always returns a real
code (a behavioral regression the existing e2e suite's `loginByPhone` helper
would immediately catch, since it hard-asserts a non-null code on every
call).

Instead: `RequestOtpUseCase.execute()` **always** creates a fresh
`OtpRequest` and returns a fresh code, exactly as before this phase.
Separately, it decides whether to also dispatch a real SMS —
`OtpRequest.shouldSkipNotification(previous, now, cooldownSeconds)` (pure,
unit-tested) skips dispatch only when the immediately prior request for the
same `(phone, purpose)` is still genuinely usable (unconsumed, unexpired,
under the attempt cap) **and** was created within the cooldown window
(`OTP_NOTIFICATION_COOLDOWN_SECONDS`, default 60s).

This is safe for every existing caller: this repo's own e2e suite (12
files, checked directly) always completes `request → verify → consume`
before requesting again for the same phone — by the time a second request
for the same `(phone, purpose)` happens, the prior one is already consumed,
so `shouldSkipNotification` never skips it. Proven directly, twice
consecutively, against the full e2e suite (`docs/product/phase-017-audit.md`).

### Known, documented remaining gap

The cooldown key is `(phone, purpose)`. A caller alternating `purpose`
(`LOGIN` → `REGISTER` → `RESET_PASSWORD`) for the same phone can still
trigger up to 3 real SMS sends per cooldown window instead of 1 — a real,
bounded gap (a small constant multiplier, not unlimited), not a silently
swept one. Fully closing it needs a phone-only (purpose-independent)
throttle, which is squarely P1-1's territory (a repo-wide rate-limiting
concern), explicitly out of this phase's own scope. Tracked in
`gap-priority-matrix.md`.

## Decision 3 — fire-and-forget dispatch, producer commits first

`RequestOtpUseCase` calls `OtpNotificationPort.sendOtpSms()` without
awaiting its resolution into the response — a dispatch failure is logged
(`RequestOtpUseCase`'s own `.catch()`) and never fails or delays the HTTP
response, because the `OtpRequest` row (the thing that actually matters —
the code exists and is verifiable) is already committed by the time
dispatch is attempted. This is the same "producer commits its own
transaction, then enqueues, never awaits a provider round-trip" rule every
other queue producer in this repo already follows (blueprint §39;
`NotificationProcessor`'s own doc comment states it explicitly for the
consumer side).

## Decision 4 — bounded Redis retention for the OTP job payload

A BullMQ job carrying a live OTP code sits in Redis as plaintext job data
until processed. `BullmqOtpNotificationAdapter` sets `removeOnComplete:
true` (prune immediately on success — no reason to keep a delivered code
around) and `removeOnFail: { count: 50 }` (bounded operator-debugging
value, not indefinite retention). No custom retry (`attempts` left at
BullMQ's default of 1): an OTP's own short TTL (`OTP_TTL_SECONDS`, 5
minutes by default) makes a backoff-retried delivery pointless — the code
would likely already be expired by the time a retried attempt ran, and
every retry window is more time the code spends live in Redis. Full threat
model: `docs/security/notification-security.md`.

## Non-goals (explicit, matching `P017`'s own scope)

- Telegram/WhatsApp/Email/Push remain stubs.
- No repo-wide rate limiting (P1-1) — the narrow OTP-dispatch cooldown
  above is the only throttle this phase adds.
- No `/metrics` exposure (CP-029's own scope) — delivery outcomes surface
  via structured logs only.
- No live-network verification against the real Kavenegar API from this
  sandbox — documented staging gap, matching ADR-008's own ZarinPal
  precedent.
- No changes to `NotificationChannelPort`, `NotificationDispatcherService`,
  or any adapter other than `SmsAdapter`.

## Consequences

- OTP delivery is real in any environment with `SMS_API_KEY` configured;
  every environment without one keeps behaving exactly as before this
  phase — zero regression, proven by the full e2e suite passing twice
  consecutively with only the same two pre-existing, unrelated,
  sandbox-load-sensitive failures CP-016's own audit already documented.
- A production caller now has a genuine, bounded cost/abuse control on the
  single highest-value notification path (OTP) without waiting on the
  broader P1-1 rate-limiting phase.
- The `(phone, purpose)`-keyed cooldown's own bounded gap (up to 3x per
  window across purposes) is accepted and documented, not hidden, pending
  P1-1.
