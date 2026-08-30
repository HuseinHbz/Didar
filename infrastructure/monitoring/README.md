# infrastructure/monitoring

## What's real (CP-029)

`prometheus.yml`'s three scrape targets (`iecp-api`, `iecp-worker`,
`iecp-notification-worker`) each expose a real, live-verified `/metrics`
endpoint today — see `docs/product/phase-029-audit.md` §3/§11 for the
evidence. `alerts.yml` defines five alerting rules against those real
metrics (`HighErrorRate`, `QueueBacklog`, `QueueFailureSpike`,
`ServiceDown`, `SlowRequests`), loaded via `prometheus.yml`'s `rule_files`.

What each metric covers, and where:

| Metric                                                                | Emitted by                                                                                                            | What it's for                                                                                         |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `iecp_http_request_duration_seconds`                                  | `services/api/src/modules/observability/http-metrics.middleware.ts`                                                   | Request rate, latency, error rate (5xx)                                                               |
| `iecp_queue_jobs`                                                     | `services/api/src/modules/observability/queue-metrics.service.ts`                                                     | Live waiting/active/delayed/failed counts, per queue, for every real BullMQ queue `services/api` owns |
| `iecp_queue_jobs_processed_total` / `iecp_queue_job_duration_seconds` | `services/worker` and `services/notification-worker`'s own `observability/job-metrics.ts`, wired via `@OnWorkerEvent` | Processor-side throughput and duration, per queue                                                     |
| process/Node.js defaults (`process_*`, `nodejs_*`)                    | `prom-client`'s `collectDefaultMetrics()` in every one of the three processes                                         | CPU, memory, event-loop lag, GC                                                                       |

## Still a stub

No Prometheus/Grafana/Alertmanager service actually runs anywhere in this
repository's `docker-compose.yml` or CI — `prometheus.yml`/`alerts.yml` are
the config a real deployment would mount, not proof one is deployed. The
alerting rules were reviewed by hand against Prometheus's documented
alerting-rule grammar, not run through `promtool check rules` (not
installed in this sandbox) — an honestly-documented gap, not a fabricated
pass. Dashboards (Grafana), log aggregation (Loki), tracing
(OpenTelemetry), and error tracking (Sentry) from blueprint §102 remain
entirely unbuilt; nothing in this phase claims otherwise.

## Blueprint §102's full stack, for reference

```
Prometheus    — metrics scraping        (real: this phase)
Grafana       — dashboards              (not started)
Loki          — log aggregation         (not started)
OpenTelemetry — tracing                 (not started)
Sentry        — error tracking          (not started)
```

## If a real deployment target exists

1. Run Prometheus and Alertmanager, pointing Prometheus at this
   `prometheus.yml` (and therefore `alerts.yml`).
2. Point Alertmanager's receivers at wherever alerts should actually go
   (email/Slack/PagerDuty) — not configured here; this repo owns the rule
   definitions, not the notification channel, which is an operational
   decision for whoever runs the real deployment.
3. Grafana/Loki/OpenTelemetry/Sentry remain real, separately-scoped future
   work — not part of what CP-029 closed (see
   `docs/adr/ADR-029-production-readiness-completion.md` for the scope
   boundary).
