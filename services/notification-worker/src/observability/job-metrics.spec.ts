import type { Job } from 'bullmq';

import { recordJobOutcome } from './job-metrics';
import { metricsRegistry } from './metrics.registry';

function fakeJob(overrides: Partial<Job> = {}): Job {
  return { processedOn: 1000, finishedOn: 1500, ...overrides } as Job;
}

describe('recordJobOutcome', () => {
  it('increments the processed counter labeled by queue and result', async () => {
    recordJobOutcome('notifications', 'completed', fakeJob());

    const output = await metricsRegistry.metrics();
    expect(output).toContain(
      'iecp_queue_jobs_processed_total{queue="notifications",result="completed"} 1',
    );
  });

  it('records a duration observation from processedOn/finishedOn, not wall-clock timing', async () => {
    recordJobOutcome(
      'notifications',
      'completed',
      fakeJob({ processedOn: 2000, finishedOn: 4000 }),
    );

    const output = await metricsRegistry.metrics();
    expect(output).toContain('iecp_queue_job_duration_seconds_sum{queue="notifications"}');
    expect(output).toMatch(
      /iecp_queue_job_duration_seconds_bucket\{le="2\.5",queue="notifications"\} \d+/,
    );
  });

  it('skips the duration observation when BullMQ has not set both timestamps yet', async () => {
    recordJobOutcome(
      'notifications',
      'failed',
      fakeJob({ processedOn: undefined, finishedOn: undefined }),
    );

    const output = await metricsRegistry.metrics();
    expect(output).toContain(
      'iecp_queue_jobs_processed_total{queue="notifications",result="failed"} 1',
    );
  });
});
