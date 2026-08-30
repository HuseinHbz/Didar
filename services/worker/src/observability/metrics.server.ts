import { createServer, type Server } from 'node:http';

import { Logger } from '@nestjs/common';

import { metricsRegistry } from './metrics.registry';

const logger = new Logger('MetricsServer');

/**
 * CP-029 (P1-5) — this worker has no HTTP surface for its actual job (see
 * `src/main.ts`'s own doc comment: "A worker has no HTTP surface"), so
 * `/metrics` gets its own minimal listener rather than pulling in
 * `@nestjs/platform-express` just to expose one route. Deliberately plain
 * `node:http`, not a second Nest application — the smallest thing that
 * serves valid Prometheus exposition text on `GET /metrics` and a 404 on
 * anything else, matching `infrastructure/monitoring/prometheus.yml`'s
 * already-declared `iecp-worker` target (`worker:9090`, `metrics_path:
 * /metrics`).
 */
export function startMetricsServer(port: number): Server {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/metrics') {
      metricsRegistry
        .metrics()
        .then((body) => {
          res.writeHead(200, { 'Content-Type': metricsRegistry.contentType });
          res.end(body);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'unknown error';
          logger.error(`failed to collect metrics: ${message}`);
          res.writeHead(500);
          res.end();
        });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    logger.log(`metrics server listening on :${port} (/metrics)`);
  });

  return server;
}
