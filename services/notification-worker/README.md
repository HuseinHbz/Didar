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

## ⚠️ Every adapter is a stub

None of the six adapters call a real provider yet — each `send()` just logs and
returns a synthetic "sent" result. Wire real providers (SMS gateway, Telegram Bot
API, WhatsApp Business API, SMTP, FCM/APNs, DB-backed in-app notifications) behind
the same `NotificationChannelPort` interface one at a time; nothing else in this
service should need to change when you do.

## Commands

```bash
pnpm --filter @iecp/notification-worker dev     # requires REDIS_URL reachable
pnpm --filter @iecp/notification-worker test
```
