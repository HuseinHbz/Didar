# @iecp/notification-worker

Multi-channel notification dispatch — SMS, Telegram, WhatsApp, Email, Push, In-App
— each behind its own adapter implementing `NotificationChannelPort`
(blueprint §38-§44), consumed from a `notifications` BullMQ queue so nothing
upstream ever blocks a request waiting on a provider (blueprint §39).

## Architecture

```
notifications/
├── notification-channel.port.ts       — the shared adapter contract
├── adapters/                          — one file per channel, all ⚠️ stubs (see below)
├── notification-dispatcher.service.ts  — routes to the right adapter + SMS fallback
└── queue/notification.processor.ts     — BullMQ consumer, the actual entry point
```

**SMS is the reliability backbone.** Per blueprint §41, WhatsApp/Telegram delivery
inside Iran isn't guaranteed, so `NotificationDispatcherService` automatically
retries over SMS if either of those two fails — see
`notification-dispatcher.service.spec.ts` for the behavior under test. SMS itself
has no further fallback by design; Email/Push/In-App failures simply propagate.

## SMS is real (CP-017) — the other five adapters are still stubs

`adapters/sms.adapter.ts` calls a real provider (Kavenegar,
https://kavenegar.com/rest.html) once `SMS_API_KEY` is configured — see
that file's own doc comment for the two endpoints it uses (Verify-Lookup
for `templateKey: 'OTP'`, the generic send endpoint for everything else)
and `docs/adr/ADR-014-real-notification-delivery.md` for the full
account, including why live end-to-end verification against Kavenegar is
a documented staging gap in this sandbox (outbound proxy denial,
confirmed the same way ADR-008 confirmed it for ZarinPal) rather than
something faked. Unset/empty `SMS_API_KEY` is a deliberate, safe
fallback to the exact pre-CP-017 stub behavior — every dev/test/CI
environment that hasn't configured a real key keeps working unchanged.

The other five adapters (Telegram, WhatsApp, Email, Push, In-App) remain
stubs, explicitly, per CP-017's own non-goals — each `send()` still just
logs and returns a synthetic "sent" result. Wire each behind the same
`NotificationChannelPort` interface one at a time; nothing else in this
service should need to change when you do.

## Commands

```bash
pnpm --filter @iecp/notification-worker dev     # requires REDIS_URL reachable
pnpm --filter @iecp/notification-worker test
```
