import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { RefundService } from '../../application/refund.service';
import {
  REFUND_REPOSITORY,
  type RefundRepositoryPort,
} from '../../domain/ports/refund.repository.port';

import {
  DEFAULT_JOB_OPTIONS,
  REFUND_STATUS_SYNC_MIN_AGE_MS,
  REFUND_STATUS_SYNC_QUEUE,
  REFUND_STATUS_SYNC_SWEEP_INTERVAL_MS,
} from './queue-names';

const SWEEP_JOB_NAME = 'sweep-refund-status-sync';
const SWEEP_SCHEDULER_ID = 'refund-status-sync-sweep';

@Injectable()
export class RefundStatusSyncQueueService implements OnModuleInit {
  constructor(@InjectQueue(REFUND_STATUS_SYNC_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: REFUND_STATUS_SYNC_SWEEP_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: {}, opts: DEFAULT_JOB_OPTIONS },
    );
  }
}

/**
 * Consumer — every `Refund` still `PENDING` more than
 * `REFUND_STATUS_SYNC_MIN_AGE_MS` after creation (created but never
 * submitted — e.g. a crash between `requestRefund()` and
 * `processRefund()`) gets driven forward through
 * `RefundService.processRefund()`, the same real provider call the
 * synchronous path uses. `RefundStateMachine.assertTransition` inside
 * `processRefund()` protects against double-processing a refund an
 * overlapping sweep already moved past `PENDING`.
 */
@Processor(REFUND_STATUS_SYNC_QUEUE)
export class RefundStatusSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(RefundStatusSyncProcessor.name);

  constructor(
    @Inject(REFUND_REPOSITORY) private readonly refunds: RefundRepositoryPort,
    private readonly refundService: RefundService,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ syncedCount: number }> {
    const cutoff = new Date(Date.now() - REFUND_STATUS_SYNC_MIN_AGE_MS);
    const stale = await this.refunds.listStalePending(cutoff);
    for (const refund of stale) {
      await this.refundService.processRefund(refund.id).catch((error: unknown) => {
        this.logger.warn(`refund_status_sync_failed refundId=${refund.id} error=${String(error)}`);
      });
    }
    this.logger.log(`refund_status_sync_sweep syncedCount=${stale.length}`);
    return { syncedCount: stale.length };
  }
}
