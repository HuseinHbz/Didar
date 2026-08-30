import { Queue } from 'bullmq';

import { metricsRegistry } from './metrics.registry';
import { MONITORED_QUEUE_NAMES } from './monitored-queues';
import { QueueMetricsService } from './queue-metrics.service';

jest.mock('bullmq', () => {
  const actual: Record<string, unknown> = jest.requireActual('bullmq');
  return {
    ...actual,
    Queue: jest.fn(),
  };
});

jest.mock('../../config/env', () => ({
  loadEnv: () => ({ REDIS_URL: 'redis://localhost:6379' }),
}));

describe('QueueMetricsService', () => {
  let getJobCounts: jest.Mock;
  let close: jest.Mock;

  beforeEach(() => {
    getJobCounts = jest.fn().mockResolvedValue({ waiting: 2, active: 1, delayed: 0, failed: 3 });
    close = jest.fn().mockResolvedValue(undefined);
    (Queue as unknown as jest.Mock).mockImplementation(() => ({ getJobCounts, close }));
  });

  afterEach(() => {
    metricsRegistry.removeSingleMetric('iecp_queue_jobs');
    jest.clearAllMocks();
  });

  it('opens one Queue handle per monitored queue name on init', () => {
    const service = new QueueMetricsService();
    service.onModuleInit();

    expect(Queue).toHaveBeenCalledTimes(MONITORED_QUEUE_NAMES.length);
    for (const name of MONITORED_QUEUE_NAMES) {
      expect(Queue).toHaveBeenCalledWith(name, { connection: { url: 'redis://localhost:6379' } });
    }
  });

  it('registers a gauge that reports real job counts per queue and state when scraped', async () => {
    const service = new QueueMetricsService();
    service.onModuleInit();

    const output = await metricsRegistry.metrics();

    expect(getJobCounts).toHaveBeenCalledWith('waiting', 'active', 'delayed', 'failed');
    const [firstQueue] = MONITORED_QUEUE_NAMES;
    expect(output).toContain(`iecp_queue_jobs{queue="${firstQueue}",state="waiting"} 2`);
    expect(output).toContain(`iecp_queue_jobs{queue="${firstQueue}",state="active"} 1`);
    expect(output).toContain(`iecp_queue_jobs{queue="${firstQueue}",state="failed"} 3`);
  });

  it('closes every Queue handle on destroy', async () => {
    const service = new QueueMetricsService();
    service.onModuleInit();
    await service.onModuleDestroy();

    expect(close).toHaveBeenCalledTimes(MONITORED_QUEUE_NAMES.length);
  });

  it('does not throw the whole scrape when one queue fails to report counts', async () => {
    getJobCounts.mockRejectedValueOnce(new Error('redis unreachable'));
    const service = new QueueMetricsService();
    service.onModuleInit();

    await expect(metricsRegistry.metrics()).resolves.toEqual(expect.any(String));
  });

  it('re-registering onModuleInit does not throw "metric already registered"', () => {
    const first = new QueueMetricsService();
    first.onModuleInit();

    const second = new QueueMetricsService();
    expect(() => {
      second.onModuleInit();
    }).not.toThrow();
  });
});
