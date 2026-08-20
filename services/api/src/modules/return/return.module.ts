import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { CartCheckoutModule } from '../cart-checkout/cart-checkout.module';
import { AUDIT_LOG_REPOSITORY } from '../identity/domain/ports/audit-log.repository.port';
import { PrismaAuditLogRepository } from '../identity/infrastructure/repositories/prisma-audit-log.repository';
import { InventoryModule } from '../inventory/inventory.module';
import { OrderModule } from '../order/order.module';
import { REFUND_REPOSITORY } from '../payment/domain/ports/refund.repository.port';
import { PrismaRefundRepository } from '../payment/infrastructure/repositories/prisma-refund.repository';
import { PaymentModule } from '../payment/payment.module';

import { CreditNoteService } from './application/credit-note.service';
import { ReturnReconciliationService } from './application/return-reconciliation.service';
import { ReturnSettlementService } from './application/return-settlement.service';
import { ReturnService } from './application/return.service';
import { CREDIT_NOTE_REPOSITORY } from './domain/ports/credit-note.repository.port';
import { RETURN_SETTLEMENT_REPOSITORY } from './domain/ports/return-settlement.repository.port';
import { RETURN_REPOSITORY } from './domain/ports/return.repository.port';
import { ReturnQueueModule } from './infrastructure/queues/return-queue.module';
import { PrismaCreditNoteRepository } from './infrastructure/repositories/prisma-credit-note.repository';
import { PrismaReturnSettlementRepository } from './infrastructure/repositories/prisma-return-settlement.repository';
import { PrismaReturnRepository } from './infrastructure/repositories/prisma-return.repository';
import { CreditNoteAdminController } from './presentation/controllers/credit-note-admin.controller';
import { ReturnAdminController } from './presentation/controllers/return-admin.controller';
import { ReturnController } from './presentation/controllers/return.controller';
import { ReturnDomainExceptionFilter } from './presentation/filters/return-domain-exception.filter';

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
 * (task #153) plus ADR-013's `return_settlement_recovery` and
 * `return_reconciliation` sweeps actually get registered on app
 * bootstrap — see that module's own doc comment for why it re-declares
 * its own repository-port bindings rather than importing this module
 * back (would create a cycle).
 *
 * `IdentityModule`'s `JwtAuthGuard`/`AuthorizationGuard` are already
 * global (`APP_GUARD`, registered in `IdentityModule`) — the admin
 * controllers here need no extra guard wiring, only
 * `@RequirePermission(...)` on each route. `ReturnController` uses
 * `ActorResolverGuard` directly, same dual-auth shape `OrderController`
 * already establishes — which is why `CartCheckoutModule` is imported
 * too: `ActorResolverGuard` itself depends on `JwtTokenService`/
 * `CUSTOMER_LOOKUP_PORT`, both provided there, not by `OrderModule`.
 */
@Module({
  imports: [CartCheckoutModule, OrderModule, PaymentModule, InventoryModule, ReturnQueueModule],
  controllers: [ReturnController, ReturnAdminController, CreditNoteAdminController],
  providers: [
    { provide: RETURN_REPOSITORY, useClass: PrismaReturnRepository },
    { provide: CREDIT_NOTE_REPOSITORY, useClass: PrismaCreditNoteRepository },
    { provide: RETURN_SETTLEMENT_REPOSITORY, useClass: PrismaReturnSettlementRepository },
    { provide: REFUND_REPOSITORY, useClass: PrismaRefundRepository },
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
    CreditNoteService,
    ReturnSettlementService,
    ReturnReconciliationService,
    ReturnService,
    { provide: APP_FILTER, useClass: ReturnDomainExceptionFilter },
  ],
  exports: [ReturnService, CreditNoteService, ReturnSettlementService, ReturnReconciliationService],
})
export class ReturnModule {}
