import { Counter } from 'prom-client';

import { metricsRegistry } from './metrics.registry';
import { startMetricsServer } from './metrics.server';

describe('startMetricsServer', () => {
  it('serves the shared registry on GET /metrics', async () => {
    new Counter({ name: 'cp029_nw_test_metric', help: 'test', registers: [metricsRegistry] }).inc(
      3,
    );
    const server = startMetricsServer(0); // 0 = OS-assigned ephemeral port
    try {
      const { port } = server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${port}/metrics`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(metricsRegistry.contentType);
      const body = await response.text();
      expect(body).toContain('cp029_nw_test_metric 3');
    } finally {
      server.close();
      metricsRegistry.removeSingleMetric('cp029_nw_test_metric');
    }
  });

  it('returns 404 for any other path', async () => {
    const server = startMetricsServer(0);
    try {
      const { port } = server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${port}/nope`);
      expect(response.status).toBe(404);
    } finally {
      server.close();
    }
  });
});
