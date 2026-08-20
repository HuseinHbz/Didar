import { Module } from '@nestjs/common';

import { AUDIT_LOG_REPOSITORY } from '../identity/domain/ports/audit-log.repository.port';
import { PrismaAuditLogRepository } from '../identity/infrastructure/repositories/prisma-audit-log.repository';
import { InventoryModule } from '../inventory/inventory.module';
import { OrderModule } from '../order/order.module';
import { PaymentModule } from '../payment/payment.module';

import { CreditNoteService } from './application/credit-note.service';
import { ReturnService } from './application/return.service';
import { CREDIT_NOTE_REPOSITORY } from './domain/ports/credit-note.repository.port';
import { RETURN_REPOSITORY } from './domain/ports/return.repository.port';
import { ReturnQueueModule } from './infrastructure/queues/return-queue.module';
import { PrismaCreditNoteRepository } from './infrastructure/repositories/prisma-credit-note.repository';
import { PrismaReturnRepository } from './infrastructure/repositories/prisma-return.repository';

/**
 * Composition root for Phase 012 (see this module's README and
 * docs/adr/ADR-012-returns-refunds-credit-notes.md). Every port token
 * below is bound to its Prisma implementation here, same convention
 * every prior phase's own composition root established.
 *
 * Imports `OrderModule` (`OrderService`/`InvoiceService`/
 * `FulfillmentService`, ADR-012 decision 2), `PaymentModule`
 * (`PaymentIntentService`/`RefundService` — the one and only refund
 * pathway, never duplicated), and `InventoryModule` (`AdjustmentService
 * .receiveReturnedStock()`, decision 6). `AUDIT_LOG_REPOSITORY` is
 * re-bound locally, same convention every other module's composition
 * root already sets, rather than importing `IdentityModule`'s
 * internals.
 *
 * Imports `ReturnQueueModule` so the `return_settlement_sync` sweep
 * (task #153) actually gets registered on app bootstrap — see that
 * module's own doc comment for why it re-declares its own repository-
 * port bindings rather than importing this module back (would create a
 * cycle).
 *
 * Controllers are added in the next task (presentation layer) — this
 * module is providers-only until then, not yet imported into the root
 * `AppModule`.
 */
@Module({
  imports: [OrderModule, PaymentModule, InventoryModule, ReturnQueueModule],
  providers: [
    { provide: RETURN_REPOSITORY, useClass: PrismaReturnRepository },
    { provide: CREDIT_NOTE_REPOSITORY, useClass: PrismaCreditNoteRepository },
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
    CreditNoteService,
    ReturnService,
  ],
  exports: [ReturnService, CreditNoteService],
})
export class ReturnModule {}
