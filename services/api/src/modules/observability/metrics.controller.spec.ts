import { Counter } from 'prom-client';

import { MetricsController } from './metrics.controller';
import { metricsRegistry } from './metrics.registry';

describe('MetricsController', () => {
  afterEach(() => {
    metricsRegistry.removeSingleMetric('cp029_test_metric');
  });

  it('serves whatever is currently registered on the shared registry, in Prometheus exposition format', async () => {
    new Counter({ name: 'cp029_test_metric', help: 'test', registers: [metricsRegistry] }).inc(5);

    const controller = new MetricsController();
    const body = await controller.metrics();

    expect(body).toContain('# TYPE cp029_test_metric counter');
    expect(body).toContain('cp029_test_metric 5');
  });
});
