import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../../identity/domain/ports/audit-log.repository.port';
import {
  REFUND_REPOSITORY,
  type RefundRepositoryPort,
} from '../../../payment/domain/ports/refund.repository.port';
import {
  CREDIT_NOTE_REPOSITORY,
  type CreditNoteRepositoryPort,
} from '../../domain/ports/credit-note.repository.port';
import {
  RETURN_REPOSITORY,
  type ReturnRepositoryPort,
} from '../../domain/ports/return.repository.port';

import {
  DEFAULT_JOB_OPTIONS,
  RETURN_SETTLEMENT_SYNC_QUEUE,
  RETURN_SETTLEMENT_SYNC_SWEEP_INTERVAL_MS,
} from './queue-names';

const SWEEP_JOB_NAME = 'sweep-return-settlement-sync';
const SWEEP_SCHEDULER_ID = 'return-settlement-sync-sweep';
const SWEEP_PAGE_LIMIT = 200;

@Injectable()
export class ReturnSettlementSyncQueueService implements OnModuleInit {
  constructor(@InjectQueue(RETURN_SETTLEMENT_SYNC_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: RETURN_SETTLEMENT_SYNC_SWEEP_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: {}, opts: DEFAULT_JOB_OPTIONS },
    );
  }
}

/**
 * Consumer — see `queue-names.ts` for the full reasoning. Every
 * `ReturnRequest` still `REFUNDED` gets its linked `Refund`/`CreditNote`
 * re-checked; `ReturnRepositoryPort.updateStatus()`'s own row lock (via
 * `ReturnStateMachine`) protects against double-processing a return an
 * overlapping sweep tick, or an admin action, already moved past
 * `REFUNDED`. A `Refund` that resolves to `FAILED`/`REJECTED` leaves its
 * `ReturnRequest` at `REFUNDED` — no automatic retry-forever loop,
 * logged for admin follow-up, the same known-limitation shape ADR-012
 * decision 8 documents.
 */
@Processor(RETURN_SETTLEMENT_SYNC_QUEUE)
export class ReturnSettlementSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(ReturnSettlementSyncProcessor.name);

  constructor(
    @Inject(RETURN_REPOSITORY) private readonly returns: ReturnRepositoryPort,
    @Inject(REFUND_REPOSITORY) private readonly refunds: RefundRepositoryPort,
    @Inject(CREDIT_NOTE_REPOSITORY) private readonly creditNotes: CreditNoteRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ syncedCount: number }> {
    const { items: stuck } = await this.returns.list({
      status: 'REFUNDED',
      limit: SWEEP_PAGE_LIMIT,
    });

    let syncedCount = 0;
    for (const request of stuck) {
      const settled = await this.isSettled(request.id, request.resolution);
      if (!settled) continue;

      const result = await this.returns
        .updateStatus(request.id, 'COMPLETED', null, 'Settlement confirmed complete', {
          completedAt: new Date(),
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `return_settlement_sync_failed returnRequestId=${request.id} error=${String(error)}`,
          );
          return null;
        });
      if (result?.transitioned) {
        await this.auditLog.record({
          actorId: null,
          action: 'RETURN_COMPLETED',
          entityType: 'ReturnRequest',
          entityId: request.id,
        });
        syncedCount += 1;
      }
    }

    this.logger.log(`return_settlement_sync_sweep syncedCount=${syncedCount}`);
    return { syncedCount };
  }

  private async isSettled(returnRequestId: string, resolution: string): Promise<boolean> {
    if (resolution === 'CREDIT_NOTE') {
      const notes = await this.creditNotes.listByReturnRequestId(returnRequestId);
      return notes.some((note) => note.status === 'ISSUED' || note.status === 'APPLIED');
    }
    const refunds = await this.refunds.listByReturnRequestId(returnRequestId);
    return refunds.some((refund) => refund.status === 'COMPLETED');
  }
}
