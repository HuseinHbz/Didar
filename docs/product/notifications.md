# Real Notification Delivery — CP-017 scope

Full architectural rationale: [`docs/adr/ADR-014-real-notification-delivery.md`](../adr/ADR-014-real-notification-delivery.md).
Full threat model: [`docs/security/notification-security.md`](../security/notification-security.md).
Business/product framing: `docs/product/blueprint.md` §38-§44.
This document says what's real **today** versus still aspirational —
same convention as `docs/product/payment.md`/`docs/product/cart-checkout.md`.

## What this phase is

Replaces `services/notification-worker`'s `SmsAdapter` stub with a real
Kavenegar SMS integration, and wires `services/api`'s identity module as
the one real producer onto the `notifications` queue that adapter is
consumed from — specifically for OTP delivery
(`POST /auth/otp/request`). Nothing else changes: `NotificationChannelPort`,
`NotificationDispatcherService`, and every adapter other than `SmsAdapter`
are untouched.

## What's real as of CP-017

- **OTP codes go out over a real SMS** once `SMS_API_KEY` is configured
  (`services/notification-worker/.env.example`) — Kavenegar's real,
  documented REST contract, not a mock.
- **A cooldown protects against SMS-dispatch cost/abuse** on the one wired
  path — `OTP_NOTIFICATION_COOLDOWN_SECONDS` (60s default), keyed on
  `(phone, purpose)`. See ADR-014 for the exact reasoning and its one
  documented remaining gap (up to 3x per window across purposes).

## What's still a stub

- **Telegram, WhatsApp, Email, Push, In-App adapters** — unchanged,
  explicit non-goal of this phase (`master-roadmap-v2.md`'s `P017`
  definition: "do not scope-creep into all six channels at once").
- **Order confirmation, shipping notice, and every other non-OTP SMS
  template** — `SmsAdapter`'s generic send path (`/sms/send.json`) is real
  and functional, but no caller in `services/api` enqueues onto it yet.
  Wiring the next real caller is a future phase's job, not retrofitted
  here.
- **Live end-to-end verification against Kavenegar** — this sandbox's
  outbound proxy denies egress to `api.kavenegar.com` (confirmed live,
  same as ADR-008's own ZarinPal precedent). The adapter is built against
  Kavenegar's real published API contract and unit-tested against a real
  local HTTP server standing in for it (`sms.adapter.spec.ts`); a staging
  environment with real network egress is required to close this gap, and
  this document says so rather than hiding it.
- **Repo-wide rate limiting (P1-1)** — unchanged, explicitly deferred by
  both CP-016 and this phase. Only the one narrow OTP-dispatch cooldown
  above exists; every other endpoint remains unthrottled.
- **`/metrics` / alerting (full P1-5)** — unchanged, CP-029's own scope.
  Delivery outcomes surface via structured logs only.

## Domain model at a glance

No schema change in this phase. The existing shape:

```
identity.otp_requests (unchanged)
  phone, codeHash, purpose, attempts, expiresAt, consumedAt, createdAt
      │
      └─ RequestOtpUseCase.execute()
           ├─ always: create() a fresh OtpRequest, return devOnlyCode (non-prod only)
           └─ conditionally (CP-017): OtpNotificationPort.sendOtpSms()
                 -> BullMQ 'notifications' queue (cross-process, consumed by
                    services/notification-worker)
                      -> NotificationDispatcherService.dispatch('SMS', ...)
                           -> SmsAdapter.send() -> Kavenegar (real, if SMS_API_KEY set)
```

## Not this phase's job

- Building an admin UI to manage notification templates or provider
  credentials (`apps/admin` is untouched, same precedent every backend-only
  phase since CP-005 has followed).
- A second SMS provider behind the same port (the port already supports
  it architecturally — `NotificationChannelPort` — but only one real
  implementation exists, matching `P017`'s own "one real SmsAdapter
  implementation" deliverable).
- Retrofitting order/shipping/promotional SMS callers.
