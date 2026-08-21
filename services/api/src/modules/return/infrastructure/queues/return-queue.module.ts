import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../../../config/env';
import { AUDIT_LOG_REPOSITORY } from '../../../identity/domain/ports/audit-log.repository.port';
import { PrismaAuditLogRepository } from '../../../identity/infrastructure/repositories/prisma-audit-log.repository';
import { REFUND_REPOSITORY } from '../../../payment/domain/ports/refund.repository.port';
import { PrismaRefundRepository } from '../../../payment/infrastructure/repositories/prisma-refund.repository';
import { CREDIT_NOTE_REPOSITORY } from '../../domain/ports/credit-note.repository.port';
import { RETURN_REPOSITORY } from '../../domain/ports/return.repository.port';
import { PrismaCreditNoteRepository } from '../repositories/prisma-credit-note.repository';
import { PrismaReturnRepository } from '../repositories/prisma-return.repository';

import { RETURN_SETTLEMENT_SYNC_QUEUE } from './queue-names';
import {
  ReturnSettlementSyncProcessor,
  ReturnSettlementSyncQueueService,
} from './return-settlement-sync.processor';

/**
 * Registers BullMQ in-process inside `services/api` for Phase 012's one
 * sweep (see `queue-names.ts` for why it exists and how often it runs).
 * Same shape `PaymentQueueModule`/`OrderQueueModule` already established:
 * re-declares its own repository-port bindings as fresh instances rather
 * than importing `ReturnModule` (the composition root) back, which would
 * create a cycle (`ReturnModule` will import this module, not the other
 * way around, once presentation-layer wiring lands).
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    BullModule.registerQueue({ name: RETURN_SETTLEMENT_SYNC_QUEUE }),
  ],
  providers: [
    { provide: RETURN_REPOSITORY, useClass: PrismaReturnRepository },
    { provide: REFUND_REPOSITORY, useClass: PrismaRefundRepository },
    { provide: CREDIT_NOTE_REPOSITORY, useClass: PrismaCreditNoteRepository },
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
    ReturnSettlementSyncQueueService,
    ReturnSettlementSyncProcessor,
  ],
})
export class ReturnQueueModule {}
