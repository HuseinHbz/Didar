import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../../../config/env';
import { CartCheckoutModule } from '../../../cart-checkout/cart-checkout.module';
import { PaymentIntentService } from '../../application/payment-intent.service';
import { ReconciliationService } from '../../application/reconciliation.service';
import { RefundService } from '../../application/refund.service';
import { PAYMENT_INTENT_REPOSITORY } from '../../domain/ports/payment-intent.repository.port';
import { PAYMENT_PROVIDER_ADAPTER_REGISTRY } from '../../domain/ports/payment-provider-adapter.port';
import { PAYMENT_PROVIDER_REPOSITORY } from '../../domain/ports/payment-provider.repository.port';
import { RECONCILIATION_RECORD_REPOSITORY } from '../../domain/ports/reconciliation-record.repository.port';
import { REFUND_REPOSITORY } from '../../domain/ports/refund.repository.port';
import { PaymentProviderAdapterRegistryImpl } from '../providers/payment-provider-adapter-registry';
import { PrismaPaymentIntentRepository } from '../repositories/prisma-payment-intent.repository';
import { PrismaPaymentProviderRepository } from '../repositories/prisma-payment-provider.repository';
import { PrismaReconciliationRecordRepository } from '../repositories/prisma-reconciliation-record.repository';
import { PrismaRefundRepository } from '../repositories/prisma-refund.repository';

import {
  PaymentVerificationRetryProcessor,
  PaymentVerificationRetryQueueService,
} from './payment-verification-retry.processor';
import {
  PAYMENT_VERIFICATION_RETRY_QUEUE,
  RECONCILIATION_QUEUE,
  REFUND_STATUS_SYNC_QUEUE,
} from './queue-names';
import { ReconciliationProcessor, ReconciliationQueueService } from './reconciliation.processor';
import {
  RefundStatusSyncProcessor,
  RefundStatusSyncQueueService,
} from './refund-status-sync.processor';

/**
 * Registers BullMQ in-process inside `services/api` for this module's
 * three sweeps (task #103 — see `queue-names.ts` for why each exists and
 * how often it runs). Same shape `CartCheckoutQueueModule` established:
 * imports `CartCheckoutModule` directly (no cycle — `CartCheckoutModule`
 * never imports anything from `payment`) to reuse its exported
 * `CheckoutService`, but re-declares this module's own repository-port
 * bindings and application services as fresh instances, since
 * `PaymentModule` (the composition root, which this module cannot import
 * without creating a cycle) owns the canonical ones.
 */
@Module({
  imports: [
    CartCheckoutModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    BullModule.registerQueue(
      { name: PAYMENT_VERIFICATION_RETRY_QUEUE },
      { name: RECONCILIATION_QUEUE },
      { name: REFUND_STATUS_SYNC_QUEUE },
    ),
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
    PaymentVerificationRetryQueueService,
    PaymentVerificationRetryProcessor,
    ReconciliationQueueService,
    ReconciliationProcessor,
    RefundStatusSyncQueueService,
    RefundStatusSyncProcessor,
  ],
})
export class PaymentQueueModule {}
