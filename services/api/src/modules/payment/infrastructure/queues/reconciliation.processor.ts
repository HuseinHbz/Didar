import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { ReconciliationService } from '../../application/reconciliation.service';
import {
  PAYMENT_INTENT_REPOSITORY,
  type PaymentIntentRepositoryPort,
} from '../../domain/ports/payment-intent.repository.port';

import {
  DEFAULT_JOB_OPTIONS,
  RECONCILIATION_QUEUE,
  RECONCILIATION_SWEEP_INTERVAL_MS,
} from './queue-names';

const SWEEP_JOB_NAME = 'sweep-reconciliation';
const SWEEP_SCHEDULER_ID = 'reconciliation-sweep';
const RECONCILIATION_WINDOW_MS = 24 * 60 * 60_000;

@Injectable()
export class ReconciliationQueueService implements OnModuleInit {
  constructor(@InjectQueue(RECONCILIATION_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: RECONCILIATION_SWEEP_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: {}, opts: DEFAULT_JOB_OPTIONS },
    );
  }
}

/**
 * Consumer — every `VERIFIED` transaction from the last 24 hours gets a
 * real `queryPayment()` comparison (ADR-008 decision 7): each run writes
 * its own timestamped `ReconciliationRecord` (never rewrites a prior
 * one), the same "the ledger records, it doesn't silently fix itself"
 * discipline `InventoryLedger` established — repeated confirmation over
 * time is itself the point, not noise.
 */
@Processor(RECONCILIATION_QUEUE)
export class ReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReconciliationProcessor.name);

  constructor(
    @Inject(PAYMENT_INTENT_REPOSITORY) private readonly intents: PaymentIntentRepositoryPort,
    private readonly reconciliation: ReconciliationService,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ checkedCount: number; mismatchCount: number }> {
    const since = new Date(Date.now() - RECONCILIATION_WINDOW_MS);
    const transactions = await this.intents.listVerifiedTransactionsSince(since);

    let mismatchCount = 0;
    for (const transaction of transactions) {
      const record = await this.reconciliation
        .reconcileTransaction(transaction.id)
        .catch((error: unknown) => {
          this.logger.warn(
            `reconciliation_failed paymentTransactionId=${transaction.id} error=${String(error)}`,
          );
          return null;
        });
      if (record && record.status !== 'MATCHED') mismatchCount += 1;
    }
    this.logger.log(
      `reconciliation_sweep checkedCount=${transactions.length} mismatchCount=${mismatchCount}`,
    );
    return { checkedCount: transactions.length, mismatchCount };
  }
}
