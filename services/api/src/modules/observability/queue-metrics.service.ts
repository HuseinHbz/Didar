import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Gauge } from 'prom-client';

import { loadEnv } from '../../config/env';

import { metricsRegistry } from './metrics.registry';
import { MONITORED_QUEUE_NAMES } from './monitored-queues';

const JOB_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

/**
 * CP-029 (P1-5) — queue-depth gauges for every real BullMQ queue this API
 * owns (`MONITORED_QUEUE_NAMES`). Deliberately opens its own read-only
 * `Queue` handles rather than threading `@InjectQueue` through six domain
 * modules just to read counts here — a second `Queue` instance pointed at
 * the same Redis-backed queue is a supported, standard BullMQ pattern for
 * exactly this ("give me counts," never `.add()`/`.process()` from this
 * handle) and keeps this module self-contained, matching the existing
 * per-service `bootstrap/wait-for-redis.ts` precedent of small, local,
 * non-shared infrastructure rather than threading one more dependency
 * through every domain module's constructor.
 *
 * The gauge uses prom-client's lazy `collect` hook — counts are fetched
 * from Redis only when something actually scrapes `/metrics`, not on a
 * background timer no one asked for.
 */
@Injectable()
export class QueueMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueMetricsService.name);
  private readonly queues = new Map<string, Queue>();

  onModuleInit(): void {
    const env = loadEnv();
    for (const name of MONITORED_QUEUE_NAMES) {
      this.queues.set(name, new Queue(name, { connection: { url: env.REDIS_URL } }));
    }

    // A test file that boots the Nest app more than once against the same
    // module-level `metricsRegistry` would hit prom-client's "metric
    // already registered" throw without this — remove any gauge left by a
    // prior instance's onModuleInit before registering this one.
    metricsRegistry.removeSingleMetric('iecp_queue_jobs');
    const populate = this.populate.bind(this);
    new Gauge<'queue' | 'state'>({
      name: 'iecp_queue_jobs',
      help: 'Current BullMQ job count per queue, by state (waiting/active/delayed/failed).',
      labelNames: ['queue', 'state'],
      registers: [metricsRegistry],
      // prom-client calls `collect` with `this` bound to the gauge itself
      // (see `CollectFunction<T> = (this: T) => …` in its own typings) —
      // using that, rather than a `gauge` variable captured by an arrow
      // function, sidesteps the self-referencing-const pattern TypeScript
      // can only type as `any` from inside its own initializer.
      collect(this: Gauge<'queue' | 'state'>) {
        return populate(this);
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    metricsRegistry.removeSingleMetric('iecp_queue_jobs');
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }

  private async populate(gauge: Gauge<'queue' | 'state'>): Promise<void> {
    await Promise.all(
      [...this.queues.entries()].map(async ([name, queue]) => {
        try {
          const counts = await queue.getJobCounts(...JOB_STATES);
          for (const state of JOB_STATES) {
            gauge.set({ queue: name, state }, counts[state] ?? 0);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown error';
          this.logger.warn(`failed to collect queue metrics for "${name}": ${message}`);
        }
      }),
    );
  }
}
