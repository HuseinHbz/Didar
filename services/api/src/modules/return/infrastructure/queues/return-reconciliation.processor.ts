import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { ReturnReconciliationService } from '../../application/return-reconciliation.service';

import {
  DEFAULT_JOB_OPTIONS,
  RETURN_RECONCILIATION_INTERVAL_MS,
  RETURN_RECONCILIATION_QUEUE,
} from './queue-names';

const SWEEP_JOB_NAME = 'sweep-return-reconciliation';
const SWEEP_SCHEDULER_ID = 'return-reconciliation-sweep';

@Injectable()
export class ReturnReconciliationQueueService implements OnModuleInit {
  constructor(@InjectQueue(RETURN_RECONCILIATION_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: RETURN_RECONCILIATION_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: {}, opts: DEFAULT_JOB_OPTIONS },
    );
  }
}

/**
 * ADR-013 decision 9 — the periodic driver for
 * `ReturnReconciliationService.reconcileAll()`. `actorUserId: null`
 * (system-generated), same convention every other sweep in this
 * codebase uses for its own audit-log entries. All correctness lives
 * in `reconcileAll()` itself (read-heavy, idempotent by construction —
 * see that service's own doc comment); this processor is only the
 * scheduled trigger, same shape as every other sweep queue here.
 */
@Processor(RETURN_RECONCILIATION_QUEUE)
export class ReturnReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReturnReconciliationProcessor.name);

  constructor(private readonly reconciliation: ReturnReconciliationService) {
    super();
  }

  async process(_job: Job): Promise<{ findings: number; manualReviewCount: number }> {
    const report = await this.reconciliation.reconcileAll(null);
    this.logger.log(
      `return_reconciliation_sweep findings=${report.findings.length} manualReviewCount=${report.manualReviewCount}`,
    );
    return { findings: report.findings.length, manualReviewCount: report.manualReviewCount };
  }
}
