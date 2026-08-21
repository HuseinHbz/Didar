import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { ReturnSettlementService } from '../../application/return-settlement.service';
import {
  RETURN_SETTLEMENT_REPOSITORY,
  type ReturnSettlementRepositoryPort,
} from '../../domain/ports/return-settlement.repository.port';

import {
  DEFAULT_JOB_OPTIONS,
  RETURN_SETTLEMENT_RECOVERY_INTERVAL_MS,
  RETURN_SETTLEMENT_RECOVERY_QUEUE,
} from './queue-names';

const SWEEP_JOB_NAME = 'sweep-return-settlement-recovery';
const SWEEP_SCHEDULER_ID = 'return-settlement-recovery-sweep';

@Injectable()
export class ReturnSettlementRecoveryQueueService implements OnModuleInit {
  constructor(@InjectQueue(RETURN_SETTLEMENT_RECOVERY_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: RETURN_SETTLEMENT_RECOVERY_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: {}, opts: DEFAULT_JOB_OPTIONS },
    );
  }
}

/**
 * ADR-013 decision 5/8 — the crash-recovery worker. Every
 * `ReturnSettlement` still `PENDING_RESTOCK`/`REFUND_REQUESTED` is
 * re-driven through `ReturnSettlementService.beginRestock()`/
 * `requestSettlement()`, the *exact same* methods the synchronous
 * admin-triggered path calls — never a distinct "repair" code path.
 * Correctness comes entirely from those methods' own idempotency (a
 * settlement already past the relevant step is a safe no-op, per-item
 * restock is guarded by `restockedAt` plus the underlying ledger
 * `idempotencyKey` unique constraint, refund/credit-note issuance are
 * guarded by their own unique constraints) — this processor adds no new
 * correctness mechanism of its own, only a periodic trigger.
 *
 * One bad row never aborts the sweep tick — the same
 * `ReturnSettlementSyncProcessor`/`RefundStatusSyncProcessor` per-row
 * try/catch discipline; a row's own failure was already recorded
 * durably inside `beginRestock()`/`requestSettlement()`'s own
 * `recordFailure()` before it re-threw here.
 */
@Processor(RETURN_SETTLEMENT_RECOVERY_QUEUE)
export class ReturnSettlementRecoveryProcessor extends WorkerHost {
  private readonly logger = new Logger(ReturnSettlementRecoveryProcessor.name);

  constructor(
    @Inject(RETURN_SETTLEMENT_REPOSITORY)
    private readonly settlements: ReturnSettlementRepositoryPort,
    private readonly settlementService: ReturnSettlementService,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ scanned: number; reDriven: number }> {
    const active = await this.settlements.listActive();
    let reDriven = 0;

    for (const settlement of active) {
      try {
        if (settlement.status === 'PENDING_RESTOCK') {
          const before = settlement.status;
          const after = await this.settlementService.beginRestock(settlement.returnRequestId, null);
          if (after.status !== before) reDriven += 1;
        } else if (settlement.status === 'REFUND_REQUESTED') {
          const before = settlement.status;
          const after = await this.settlementService.requestSettlement(
            settlement.returnRequestId,
            null,
          );
          if (after.status !== before) reDriven += 1;
        }
      } catch (error) {
        this.logger.warn(
          `return_settlement_recovery_failed returnRequestId=${settlement.returnRequestId} settlementId=${settlement.id} status=${settlement.status} attempts=${settlement.attempts} error=${String(error)}`,
        );
      }
    }

    this.logger.log(
      `return_settlement_recovery_sweep scanned=${active.length} reDriven=${reDriven}`,
    );
    return { scanned: active.length, reDriven };
  }
}
