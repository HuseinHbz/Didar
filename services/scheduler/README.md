# @iecp/scheduler

Cron-driven scheduled tasks — `@nestjs/schedule`, in-process cron, not queue-driven.
Contrast with `services/worker`/`services/notification-worker`: those react to
enqueued jobs; this one wakes up on a time schedule (retention reminders §128,
cart-abandonment timers §69, nightly analytics/report rollups §102, etc).

If a scheduled task needs to do non-trivial async work (send 10k notifications, for
example), it should enqueue jobs onto a `services/worker`/`notification-worker`
queue rather than doing the work inline in the cron handler — keeps a slow run from
blocking the next tick.

## What's here

`src/tasks/example/` — one `@Cron` task (`ExampleTask`, hourly), proving the
`@nestjs/schedule` + `@iecp/database` wiring. Not a real business task.

## Commands

```bash
pnpm --filter @iecp/scheduler dev
```
