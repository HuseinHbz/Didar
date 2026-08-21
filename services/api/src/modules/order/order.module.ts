import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { CartCheckoutModule } from '../cart-checkout/cart-checkout.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AUDIT_LOG_REPOSITORY } from '../identity/domain/ports/audit-log.repository.port';
import { PrismaAuditLogRepository } from '../identity/infrastructure/repositories/prisma-audit-log.repository';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentModule } from '../payment/payment.module';
import { PromotionModule } from '../promotion/promotion.module';

import { FulfillmentService } from './application/fulfillment.service';
import { InvoiceService } from './application/invoice.service';
import { OrderConversionService } from './application/order-conversion.service';
import { OrderService } from './application/order.service';
import { FULFILLMENT_REPOSITORY } from './domain/ports/fulfillment.repository.port';
import { INVOICE_REPOSITORY } from './domain/ports/invoice.repository.port';
import { ORDER_REPOSITORY } from './domain/ports/order.repository.port';
import { SHIPPING_PROVIDER } from './domain/ports/shipping-provider.port';
import { ManualShippingProvider } from './infrastructure/providers/manual-shipping-provider';
import { OrderQueueModule } from './infrastructure/queues/order-queue.module';
import { PrismaFulfillmentRepository } from './infrastructure/repositories/prisma-fulfillment.repository';
import { PrismaInvoiceRepository } from './infrastructure/repositories/prisma-invoice.repository';
import { PrismaOrderRepository } from './infrastructure/repositories/prisma-order.repository';
import { FulfillmentAdminController } from './presentation/controllers/fulfillment-admin.controller';
import { InvoiceAdminController } from './presentation/controllers/invoice-admin.controller';
import { OrderAdminController } from './presentation/controllers/order-admin.controller';
import { OrderController } from './presentation/controllers/order.controller';
import { ShipmentLookupAdminController } from './presentation/controllers/shipment-lookup-admin.controller';
import { OrderDomainExceptionFilter } from './presentation/filters/order-domain-exception.filter';

/**
 * Composition root for Phase 009 (see this module's README and
 * docs/adr/ADR-009-order-fulfillment.md). Every port token below is
 * bound to its Prisma implementation here, same convention every prior
 * phase's own composition root established.
 *
 * Imports `CartCheckoutModule` (`CheckoutService`, `ActorResolverGuard`,
 * `CUSTOMER_LOOKUP_PORT`), `CatalogModule` (`SkusService`/
 * `ProductsService`), `InventoryModule` (`ReservationService`), and
 * `PaymentModule` (`PaymentIntentService`/`RefundService`) — the four
 * modules `OrderConversionService`/`OrderService` reach back into,
 * ADR-009 decision 9. Imports `OrderQueueModule` so the
 * `order_conversion`/`invoice_generation` sweeps (task #122) actually
 * get registered on app bootstrap — see that module's own doc comment
 * for why it re-declares its own repository-port bindings and
 * application services rather than importing this module back (would
 * create a cycle).
 *
 * `IdentityModule`'s `JwtAuthGuard`/`AuthorizationGuard` are already
 * global (`APP_GUARD`, registered in `IdentityModule`) — the admin
 * controllers here need no extra guard wiring, only
 * `@RequirePermission(...)` on each route. `AUDIT_LOG_REPOSITORY` is
 * re-bound locally, same convention `catalog`/`inventory` already set,
 * rather than importing `IdentityModule`'s internals.
 */
@Module({
  imports: [
    CartCheckoutModule,
    CatalogModule,
    InventoryModule,
    PaymentModule,
    PromotionModule,
    OrderQueueModule,
  ],
  controllers: [
    OrderController,
    OrderAdminController,
    FulfillmentAdminController,
    ShipmentLookupAdminController,
    InvoiceAdminController,
  ],
  providers: [
    { provide: ORDER_REPOSITORY, useClass: PrismaOrderRepository },
    { provide: INVOICE_REPOSITORY, useClass: PrismaInvoiceRepository },
    { provide: FULFILLMENT_REPOSITORY, useClass: PrismaFulfillmentRepository },
    { provide: SHIPPING_PROVIDER, useClass: ManualShippingProvider },
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
    OrderConversionService,
    OrderService,
    InvoiceService,
    FulfillmentService,
    { provide: APP_FILTER, useClass: OrderDomainExceptionFilter },
  ],
  // Phase 012 (ADR-012 decision 2) — additive: `OrderService`/
  // `InvoiceService`/`FulfillmentService` exported so `ReturnModule` can
  // import this module directly and inject them, the same
  // reach-through-exports shape `PaymentModule`/`InventoryModule` already
  // use for their own consumers, rather than `ReturnModule` re-binding
  // `ORDER_REPOSITORY`/`INVOICE_REPOSITORY`/`FULFILLMENT_REPOSITORY`
  // locally. Nothing removed, nothing renamed — every existing consumer
  // of this module is unaffected.
  exports: [OrderService, InvoiceService, FulfillmentService],
})
export class OrderModule {}
