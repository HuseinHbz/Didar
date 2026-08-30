import type { Job } from 'bullmq';
import { Counter, Histogram } from 'prom-client';

import { metricsRegistry } from './metrics.registry';

const jobsProcessed = new Counter({
  name: 'iecp_queue_jobs_processed_total',
  help: 'Total BullMQ jobs this worker process has finished, labeled by queue and result (completed/failed).',
  labelNames: ['queue', 'result'],
  registers: [metricsRegistry],
});

const jobDuration = new Histogram({
  name: 'iecp_queue_job_duration_seconds',
  help: 'BullMQ job processing duration in seconds (processedOn to finishedOn), labeled by queue.',
  labelNames: ['queue'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [metricsRegistry],
});

/**
 * CP-029 (P1-5) — call from a `@OnWorkerEvent('completed')`/
 * `@OnWorkerEvent('failed')` handler on each `Processor`. Uses BullMQ's own
 * `job.processedOn`/`job.finishedOn` timestamps (set by BullMQ itself, not
 * measured here) rather than a manually-started timer, so duration is
 * accurate even across a process restart mid-job.
 */
export function recordJobOutcome(
  queueName: string,
  result: 'completed' | 'failed',
  job: Job,
): void {
  jobsProcessed.inc({ queue: queueName, result });
  if (job.processedOn !== undefined && job.finishedOn !== undefined) {
    jobDuration.observe({ queue: queueName }, (job.finishedOn - job.processedOn) / 1000);
  }
}
