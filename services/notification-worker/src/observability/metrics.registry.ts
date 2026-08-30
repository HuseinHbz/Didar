import { Registry, collectDefaultMetrics } from 'prom-client';

/**
 * CP-029 (P1-5, gap-priority-matrix.md) — this worker's Prometheus
 * `Registry`. See services/api's own copy of this file for why it's a
 * single module-level instance rather than DI-scoped; the same reasoning
 * applies here. Exposed over its own minimal HTTP listener
 * (`metrics.server.ts`), not this service's main HTTP surface — this
 * service has none (see `src/main.ts`'s own doc comment).
 */
export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry });
