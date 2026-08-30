import { Registry, collectDefaultMetrics } from 'prom-client';

/**
 * CP-029 (P1-5, gap-priority-matrix.md) — the one Prometheus `Registry` every
 * metric in this process is collected into. A single module-level instance
 * (not per-request, not DI-scoped) is deliberate: prom-client's own default
 * metrics (`collectDefaultMetrics`) register themselves against whatever
 * registry is passed once, at import time — a second registry per test/request
 * would either throw ("metric already registered") or silently fragment
 * collection across instances that never get scraped together.
 *
 * `infrastructure/monitoring/prometheus.yml`'s `iecp-api` scrape target is
 * what actually turns this into something real — see
 * `docs/product/phase-029-audit.md` §3 for what's wired vs. still a stub.
 */
export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry });
