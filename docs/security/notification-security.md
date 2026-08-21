# Notification security (CP-017)

This document is `docs/security/README.md`'s service-wide security posture,
expanded for what CP-017 added: a real Kavenegar SMS integration and the
one real producer onto it (OTP delivery). Read
[`README.md`](./README.md) first for what applies service-wide; this file
is scope-limited to what CP-017 actually changed.

## Threat model: what this integration can and cannot affect

- **A leaked `SMS_API_KEY` lets an attacker send SMS on the account's
  Kavenegar credit** — a real, standard third-party-API-key exposure risk,
  no different in kind from `PAYMENT_ZARINPAL_MERCHANT_ID` or any other
  provider credential this codebase already holds. It cannot grant access
  to this system's own authentication, authorization, or business data —
  none of that is derivable from the key. Mitigated the same way every
  other provider credential here is: env-var only, never committed, never
  logged (see below).
- **A leaked or compromised Redis instance can expose in-flight OTP
  codes** — a real, non-hypothetical exposure surface, since the code
  travels through the `notifications` BullMQ job payload as plaintext.
  Bounded, not eliminated: `removeOnComplete: true` prunes a job the
  moment it's processed, `removeOnFail: { count: 50 }` bounds how many
  failed (never-delivered) jobs — the ones most likely to still carry a
  usable code — are retained, and no retry/backoff extends how long a job
  stays live (an OTP's own 5-minute default TTL makes retrying past that
  window pointless anyway). This does not change Redis's own operational
  security posture (auth/TLS/network perimeter) — that remains whatever
  CP-016's `docs/security/redis-security.md` already established for the
  Redis instance itself.
- **SMS-dispatch cost/abuse** — before this phase, `POST /auth/otp/request`
  had zero throttling of any kind (verified directly by reading
  `RequestOtpUseCase`/`AuthController` before writing any code) and no
  real SMS was ever sent, so the endpoint's only cost was a cheap DB
  write. Once SMS is real, the same endpoint could otherwise be used to
  drive unbounded real-money SMS-provider cost, or as a phone-number-
  enumeration/spam vector, against any phone number a caller supplies (no
  ownership check exists or is expected — this is the pre-authentication
  OTP-request step, by design). Mitigated by the `(phone, purpose)`-keyed
  cooldown (`OtpRequest.shouldSkipNotification`, `OTP_NOTIFICATION_
COOLDOWN_SECONDS`, default 60s) — see `docs/adr/ADR-014-real-
notification-delivery.md` decision 2 for the full design and its one
  **documented, not hidden, remaining gap**: the cooldown is keyed on
  `(phone, purpose)`, so a caller alternating `purpose` values for the
  same phone can still drive up to 3 real sends per window instead of 1.
  Fully closing this needs a phone-only throttle, which is P1-1's
  (repo-wide rate limiting) territory, explicitly out of this phase's own
  scope — tracked, not silently accepted as "solved."

## Credential and secret handling (verified, not just stated)

Every new code path this phase introduced follows the same rule enforced
throughout this codebase: log only what's needed to operate, never a
credential or a secret value.

- `SmsAdapter` never logs `SMS_API_KEY` — confirmed directly by a live
  unit-test assertion (`sms.adapter.spec.ts`: the real HTTP request body
  captured by a real local server is asserted to **not** contain the test
  API key, proving it only ever appears in the URL path, Kavenegar's own
  documented contract, never duplicated into a loggable body).
- `SmsAdapter`'s log lines (`send()`'s success/failure paths) include only
  `message.to` (recipient phone — already logged elsewhere in this
  codebase, e.g. `SecurityEvent.metadata`, not treated as a secret here)
  and `templateKey`/provider status text — never `message.variables`,
  which is where the OTP code itself lives.
- `RequestOtpUseCase`'s own dispatch-failure log line
  (`this.logger.warn(...)`) includes the phone number and the error
  reason string only — never the code.
- `BullmqOtpNotificationAdapter`'s job payload does carry the raw code (it
  has to — that's the only way the SMS text gets built) — this is the
  Redis-at-rest exposure documented above, not a logging leak.

## What this phase does not add

- No new authentication/authorization surface — `POST /auth/otp/request`
  stays `@Public()`, unchanged; no new route was added.
- No new IDOR surface — this phase touches no resource ownership checks.
- No TLS/auth changes to the connection between `services/api`/
  `services/notification-worker` and Redis — unchanged from CP-016.
- No repo-wide rate limiting (P1-1) — see above.
