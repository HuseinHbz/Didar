# @iecp/worker

Generic background-job worker — Redis + BullMQ (blueprint §62): image processing,
PDF invoice generation, search indexing, analytics events, and anything else that
must not block a request/response cycle. Distinct from `notification-worker`
(dedicated to the multi-channel notification fan-out) and `scheduler` (cron-driven,
not queue-driven).

No HTTP surface — this is a `NestFactory.createApplicationContext`, not a web
server (contrast with `services/api/src/main.ts`).

## What's here

`src/queues/example/` is a template, not a real queue: a processor
(`ExampleProcessor`, receives jobs), a producer service (`ExampleQueueService`,
enqueues jobs), and a unit test showing the producer is testable without a real
Redis connection. Copy this shape for the first real queue (an order-service module
would inject a queue producer the same way `ExampleQueueService` is injected here).

## Commands

```bash
pnpm --filter @iecp/worker dev     # requires REDIS_URL reachable (see infrastructure/docker)
pnpm --filter @iecp/worker test
```
