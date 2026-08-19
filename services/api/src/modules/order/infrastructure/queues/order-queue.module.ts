import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../../../config/env';
import { CartCheckoutModule } from '../../../cart-checkout/cart-checkout.module';
import { CatalogModule } from '../../../catalog/catalog.module';
import { AUDIT_LOG_REPOSITORY } from '../../../identity/domain/ports/audit-log.repository.port';
import { PrismaAuditLogRepository } from '../../../identity/infrastructure/repositories/prisma-audit-log.repository';
import { InventoryModule } from '../../../inventory/inventory.module';
import { PaymentModule } from '../../../payment/payment.module';
import { InvoiceService } from '../../application/invoice.service';
import { OrderConversionService } from '../../application/order-conversion.service';
import { INVOICE_REPOSITORY } from '../../domain/ports/invoice.repository.port';
import { ORDER_REPOSITORY } from '../../domain/ports/order.repository.port';
import { PrismaInvoiceRepository } from '../repositories/prisma-invoice.repository';
import { PrismaOrderRepository } from '../repositories/prisma-order.repository';

import {
  InvoiceGenerationProcessor,
  InvoiceGenerationQueueService,
} from './invoice-generation.processor';
import {
  OrderConversionProcessor,
  OrderConversionQueueService,
} from './order-conversion.processor';
import { INVOICE_GENERATION_QUEUE, ORDER_CONVERSION_QUEUE } from './queue-names';

/**
 * Registers BullMQ in-process inside `services/api` for this module's two
 * sweeps (task #122 — see `queue-names.ts` for why each exists and how
 * often it runs). Imports `CartCheckoutModule`, `CatalogModule`,
 * `InventoryModule`, and `PaymentModule` directly — none of those import
 * anything from `order`, so no cycle — for their exported services
 * (`CheckoutService`, `SkusService`/`ProductsService`,
 * `ReservationService`, `PaymentIntentService`/`RefundService`
 * respectively, all consumed by `OrderConversionService`). Re-declares
 * only this module's own repository-port bindings and application
 * services as fresh instances (`OrderModule`, the composition root that
 * imports this module, cannot be imported back without creating a
 * cycle) — same precedent `PaymentQueueModule`/`CartCheckoutQueueModule`
 * already established.
 */
@Module({
  imports: [
    CartCheckoutModule,
    CatalogModule,
    InventoryModule,
    PaymentModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    BullModule.registerQueue({ name: ORDER_CONVERSION_QUEUE }, { name: INVOICE_GENERATION_QUEUE }),
  ],
  providers: [
    { provide: ORDER_REPOSITORY, useClass: PrismaOrderRepository },
    { provide: INVOICE_REPOSITORY, useClass: PrismaInvoiceRepository },
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
    OrderConversionService,
    InvoiceService,
    OrderConversionQueueService,
    OrderConversionProcessor,
    InvoiceGenerationQueueService,
    InvoiceGenerationProcessor,
  ],
})
export class OrderQueueModule {}
