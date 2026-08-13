import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../../../config/env';
import { CatalogModule } from '../../../catalog/catalog.module';
import { InventoryModule } from '../../../inventory/inventory.module';
import { CartPricingService } from '../../application/cart-pricing.service';
import { CartService } from '../../application/cart.service';
import { CheckoutService } from '../../application/checkout.service';
import { CART_REPOSITORY } from '../../domain/ports/cart.repository.port';
import { CHECKOUT_SESSION_REPOSITORY } from '../../domain/ports/checkout-session.repository.port';
import { COUPON_LOOKUP_PORT } from '../../domain/ports/coupon-lookup.port';
import { CUSTOMER_LOOKUP_PORT } from '../../domain/ports/customer-lookup.port';
import { SHIPPING_METHOD_REPOSITORY } from '../../domain/ports/shipping-method.repository.port';
import { PrismaCartRepository } from '../repositories/prisma-cart.repository';
import { PrismaCheckoutSessionRepository } from '../repositories/prisma-checkout-session.repository';
import { PrismaCouponLookupRepository } from '../repositories/prisma-coupon-lookup.repository';
import { PrismaCustomerLookupRepository } from '../repositories/prisma-customer-lookup.repository';
import { PrismaShippingMethodRepository } from '../repositories/prisma-shipping-method.repository';

import {
  CartAbandonmentProcessor,
  CartAbandonmentQueueService,
} from './cart-abandonment.processor';
import {
  CheckoutExpirationProcessor,
  CheckoutExpirationQueueService,
} from './checkout-expiration.processor';
import { CART_ABANDONMENT_QUEUE, CHECKOUT_EXPIRATION_QUEUE } from './queue-names';

/**
 * Registers BullMQ in-process inside `services/api` for this module's two
 * expiration sweeps — same ADR-006 decision 8 precedent
 * `InventoryQueueModule` established, applied here per ADR-007 decision 3.
 *
 * Unlike `InventoryQueueModule` (which cannot import `InventoryModule`
 * without creating a cycle, since `InventoryModule` is the one importing
 * *it*), this module has no such constraint: `CartCheckoutModule` imports
 * this module, not the other way around, and neither `CatalogModule` nor
 * `InventoryModule` import anything from `cart-checkout`. So this module
 * imports `CatalogModule`/`InventoryModule` directly and reuses their
 * exported singletons (`ProductsService`/`SkusService`/`PricingService`,
 * `AllocationService`/`ReservationService`/`StockQueryService`) rather
 * than re-declaring fresh instances of them.
 *
 * `CartService`/`CheckoutService`/`CartPricingService` themselves *are*
 * re-declared here as fresh instances (with their own repository-port
 * bindings, rebound to the same stateless Prisma implementations) — those
 * three are owned by `CartCheckoutModule`, which this module cannot
 * import without creating the cycle, so this is the same "separate
 * instance for the queue processors" precedent `InventoryQueueModule`'s
 * own doc comment explains for `ReservationService`/`LowStockService`.
 */
@Module({
  imports: [
    CatalogModule,
    InventoryModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    BullModule.registerQueue({ name: CHECKOUT_EXPIRATION_QUEUE }, { name: CART_ABANDONMENT_QUEUE }),
  ],
  providers: [
    { provide: CART_REPOSITORY, useClass: PrismaCartRepository },
    { provide: SHIPPING_METHOD_REPOSITORY, useClass: PrismaShippingMethodRepository },
    { provide: CHECKOUT_SESSION_REPOSITORY, useClass: PrismaCheckoutSessionRepository },
    { provide: CUSTOMER_LOOKUP_PORT, useClass: PrismaCustomerLookupRepository },
    { provide: COUPON_LOOKUP_PORT, useClass: PrismaCouponLookupRepository },
    CartPricingService,
    CartService,
    CheckoutService,
    CheckoutExpirationQueueService,
    CheckoutExpirationProcessor,
    CartAbandonmentQueueService,
    CartAbandonmentProcessor,
  ],
})
export class CartCheckoutQueueModule {}
