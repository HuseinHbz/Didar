import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Histogram } from 'prom-client';

import { metricsRegistry } from './metrics.registry';

metricsRegistry.removeSingleMetric('iecp_http_request_duration_seconds');
const httpRequestDuration = new Histogram({
  name: 'iecp_http_request_duration_seconds',
  help: 'HTTP request duration in seconds, labeled by method, route, and status code.',
  labelNames: ['method', 'route', 'status_code'],
  // Buckets tuned for an API, not a static site — sub-10ms to multi-second
  // (a slow report/aggregation route should still fall inside the top bucket
  // rather than all landing in `+Inf`).
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

/**
 * CP-029 (P1-5) — the one HTTP-level metric this pass wires: request
 * duration, labeled by route *pattern* (`req.route.path`, e.g.
 * `/catalog/products/:id`), not the raw URL (which would explode
 * cardinality — one time series per product ID scraped forever). Falls back
 * to `unmatched` for anything that never reached a route handler (404s,
 * malformed paths) so those still count without inventing a label per typo.
 *
 * The alert this metric backs — `HighErrorRate` in
 * `infrastructure/monitoring/alerts.yml` — reads the histogram's own
 * `_count` series filtered by `status_code`, not a separate counter; a
 * second `Counter` tracking exactly what the histogram already tracks
 * would be redundant instrumentation, not additional coverage.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = (req.route as { path?: string } | undefined)?.path ?? 'unmatched';
      httpRequestDuration.observe(
        { method: req.method, route, status_code: String(res.statusCode) },
        durationSeconds,
      );
    });
    next();
  }
}
