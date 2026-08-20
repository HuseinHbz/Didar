import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../../../config/env';
import { AUDIT_LOG_REPOSITORY } from '../../../identity/domain/ports/audit-log.repository.port';
import { PrismaAuditLogRepository } from '../../../identity/infrastructure/repositories/prisma-audit-log.repository';
import { InventoryModule } from '../../../inventory/inventory.module';
import { OrderModule } from '../../../order/order.module';
import { REFUND_REPOSITORY } from '../../../payment/domain/ports/refund.repository.port';
import { PrismaRefundRepository } from '../../../payment/infrastructure/repositories/prisma-refund.repository';
import { PaymentModule } from '../../../payment/payment.module';
import { CreditNoteService } from '../../application/credit-note.service';
import { ReturnReconciliationService } from '../../application/return-reconciliation.service';
import { ReturnSettlementService } from '../../application/return-settlement.service';
import { CREDIT_NOTE_REPOSITORY } from '../../domain/ports/credit-note.repository.port';
import { RETURN_SETTLEMENT_REPOSITORY } from '../../domain/ports/return-settlement.repository.port';
import { RETURN_REPOSITORY } from '../../domain/ports/return.repository.port';
import { PrismaCreditNoteRepository } from '../repositories/prisma-credit-note.repository';
import { PrismaReturnSettlementRepository } from '../repositories/prisma-return-settlement.repository';
import { PrismaReturnRepository } from '../repositories/prisma-return.repository';

import {
  RETURN_RECONCILIATION_QUEUE,
  RETURN_SETTLEMENT_RECOVERY_QUEUE,
  RETURN_SETTLEMENT_SYNC_QUEUE,
} from './queue-names';
import {
  ReturnReconciliationProcessor,
  ReturnReconciliationQueueService,
} from './return-reconciliation.processor';
import {
  ReturnSettlementRecoveryProcessor,
  ReturnSettlementRecoveryQueueService,
} from './return-settlement-recovery.processor';
import {
  ReturnSettlementSyncProcessor,
  ReturnSettlementSyncQueueService,
} from './return-settlement-sync.processor';

/**
 * Registers BullMQ in-process inside `services/api` for this module's
 * three sweeps: Phase 012's `return_settlement_sync` (see `queue-names.ts`)
 * plus Phase 013's `return_settlement_recovery` and `return_reconciliation`
 * (ADR-013 decisions 5/8/9). Same shape `OrderQueueModule` already
 * established: re-declares its own repository-port bindings and
 * application services as fresh instances rather than importing
 * `ReturnModule` (the composition root that imports *this* module) back,
 * which would create a cycle.
 *
 * Imports `OrderModule`, `PaymentModule`, and `InventoryModule` directly
 * — the same three modules `ReturnModule` itself imports for the same
 * services (`OrderService`/`InvoiceService`, `PaymentIntentService`/
 * `RefundService`, `AdjustmentService`) — because `ReturnSettlementService`
 * needs the exact same dependency graph here as it does in the
 * synchronous admin path. None of those three modules import `return`
 * back (`OrderQueueModule` already imports `InventoryModule`/
 * `PaymentModule` directly for the same reason), so this introduces no
 * cycle.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    BullModule.registerQueue(
      { name: RETURN_SETTLEMENT_SYNC_QUEUE },
      { name: RETURN_SETTLEMENT_RECOVERY_QUEUE },
      { name: RETURN_RECONCILIATION_QUEUE },
    ),
    OrderModule,
    PaymentModule,
    InventoryModule,
  ],
  providers: [
    { provide: RETURN_REPOSITORY, useClass: PrismaReturnRepository },
    { provide: RETURN_SETTLEMENT_REPOSITORY, useClass: PrismaReturnSettlementRepository },
    { provide: REFUND_REPOSITORY, useClass: PrismaRefundRepository },
    { provide: CREDIT_NOTE_REPOSITORY, useClass: PrismaCreditNoteRepository },
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
    CreditNoteService,
    ReturnSettlementService,
    ReturnReconciliationService,
    ReturnSettlementSyncProcessor,
    ReturnSettlementSyncQueueService,
    ReturnSettlementRecoveryProcessor,
    ReturnSettlementRecoveryQueueService,
    ReturnReconciliationProcessor,
    ReturnReconciliationQueueService,
  ],
})
export class ReturnQueueModule {}
