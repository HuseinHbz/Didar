import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { CartCheckoutModule } from '../cart-checkout/cart-checkout.module';

import { PaymentIntentService } from './application/payment-intent.service';
import { ReconciliationService } from './application/reconciliation.service';
import { RefundService } from './application/refund.service';
import { PAYMENT_INTENT_REPOSITORY } from './domain/ports/payment-intent.repository.port';
import { PAYMENT_PROVIDER_ADAPTER_REGISTRY } from './domain/ports/payment-provider-adapter.port';
import { PAYMENT_PROVIDER_REPOSITORY } from './domain/ports/payment-provider.repository.port';
import { RECONCILIATION_RECORD_REPOSITORY } from './domain/ports/reconciliation-record.repository.port';
import { REFUND_REPOSITORY } from './domain/ports/refund.repository.port';
import { PaymentProviderAdapterRegistryImpl } from './infrastructure/providers/payment-provider-adapter-registry';
import { PaymentQueueModule } from './infrastructure/queues/payment-queue.module';
import { PrismaPaymentIntentRepository } from './infrastructure/repositories/prisma-payment-intent.repository';
import { PrismaPaymentProviderRepository } from './infrastructure/repositories/prisma-payment-provider.repository';
import { PrismaReconciliationRecordRepository } from './infrastructure/repositories/prisma-reconciliation-record.repository';
import { PrismaRefundRepository } from './infrastructure/repositories/prisma-refund.repository';
import { PaymentCallbackController } from './presentation/controllers/payment-callback.controller';
import { PaymentIntentController } from './presentation/controllers/payment-intent.controller';
import { ReconciliationController } from './presentation/controllers/reconciliation.controller';
import { RefundController } from './presentation/controllers/refund.controller';
import { PaymentDomainExceptionFilter } from './presentation/filters/payment-domain-exception.filter';

/**
 * Composition root for Phase 008 (see this module's README and
 * docs/adr/ADR-008-payment-orchestration.md). Every port token below is
 * bound to its Prisma implementation here, same convention every prior
 * phase's own composition root established.
 *
 * Imports `CartCheckoutModule` for its exported `CheckoutService`
 * (ADR-008 decision 10) — the one place this module reaches back into
 * cart-checkout, and only through that real service, never a raw Prisma
 * write. Imports `PaymentQueueModule` so the `payment_verification_retry`/
 * `reconciliation`/`refund_status_sync` sweeps (task #103) actually get
 * registered on app bootstrap — see that module's own doc comment for
 * why it re-declares its own repository-port bindings and application
 * services rather than importing this module back (would create a
 * cycle).
 *
 * `IdentityModule`'s `JwtAuthGuard`/`AuthorizationGuard` are already
 * global (`APP_GUARD`, registered in `IdentityModule`) — `RefundController`/
 * `ReconciliationController` need no extra guard wiring here, only
 * `@RequirePermission(...)` on each route.
 */
@Module({
  imports: [CartCheckoutModule, PaymentQueueModule],
  controllers: [
    PaymentIntentController,
    PaymentCallbackController,
    RefundController,
    ReconciliationController,
  ],
  providers: [
    { provide: PAYMENT_PROVIDER_REPOSITORY, useClass: PrismaPaymentProviderRepository },
    { provide: PAYMENT_INTENT_REPOSITORY, useClass: PrismaPaymentIntentRepository },
    { provide: REFUND_REPOSITORY, useClass: PrismaRefundRepository },
    {
      provide: RECONCILIATION_RECORD_REPOSITORY,
      useClass: PrismaReconciliationRecordRepository,
    },
    { provide: PAYMENT_PROVIDER_ADAPTER_REGISTRY, useClass: PaymentProviderAdapterRegistryImpl },
    PaymentIntentService,
    RefundService,
    ReconciliationService,
    { provide: APP_FILTER, useClass: PaymentDomainExceptionFilter },
  ],
})
export class PaymentModule {}
