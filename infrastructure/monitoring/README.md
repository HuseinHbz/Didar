# infrastructure/monitoring

## ⚠️ Stub — nothing here is wired up yet

`prometheus.yml` declares the _intended_ scrape targets (blueprint §102), but no
service currently exposes a `/metrics` endpoint, so none of them resolve to
anything real. Nothing runs this config anywhere yet either — there's no
Prometheus/Grafana service in `infrastructure/docker/docker-compose.yml`.

## What blueprint §102 actually calls for

```
Prometheus   — metrics scraping
Grafana      — dashboards
Loki         — log aggregation
OpenTelemetry — tracing
Sentry       — error tracking
```

Metrics worth tracking once wired: API latency, error rate, DB connections, queue
depth, Redis, order rate, payment failure rate.

## Suggested order of operations (not started)

1. Add `@willsoto/nestjs-prometheus` (or equivalent) to `services/api` and expose
   `/metrics`.
2. Add a `prometheus` + `grafana` service to `infrastructure/docker/docker-compose.yml`,
   mount this `prometheus.yml`.
3. Wire Sentry (or self-hosted equivalent) for error tracking across all four
   NestJS services and the three Next.js apps.
4. OpenTelemetry tracing once there's more than one service worth tracing a
   request across.
