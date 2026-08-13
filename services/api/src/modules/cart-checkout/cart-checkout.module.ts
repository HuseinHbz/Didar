import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { CatalogModule } from '../catalog/catalog.module';
import { IdentityModule } from '../identity/identity.module';
import { InventoryModule } from '../inventory/inventory.module';

import { CartPricingService } from './application/cart-pricing.service';
import { CartService } from './application/cart.service';
import { CheckoutService } from './application/checkout.service';
import { CART_REPOSITORY } from './domain/ports/cart.repository.port';
import { CHECKOUT_SESSION_REPOSITORY } from './domain/ports/checkout-session.repository.port';
import { COUPON_LOOKUP_PORT } from './domain/ports/coupon-lookup.port';
import { CUSTOMER_LOOKUP_PORT } from './domain/ports/customer-lookup.port';
import { SHIPPING_METHOD_REPOSITORY } from './domain/ports/shipping-method.repository.port';
import { CartCheckoutQueueModule } from './infrastructure/queues/cart-checkout-queue.module';
import { PrismaCartRepository } from './infrastructure/repositories/prisma-cart.repository';
import { PrismaCheckoutSessionRepository } from './infrastructure/repositories/prisma-checkout-session.repository';
import { PrismaCouponLookupRepository } from './infrastructure/repositories/prisma-coupon-lookup.repository';
import { PrismaCustomerLookupRepository } from './infrastructure/repositories/prisma-customer-lookup.repository';
import { PrismaShippingMethodRepository } from './infrastructure/repositories/prisma-shipping-method.repository';
import { CartController } from './presentation/controllers/cart.controller';
import { CheckoutController } from './presentation/controllers/checkout.controller';
import { CartCheckoutDomainExceptionFilter } from './presentation/filters/cart-checkout-domain-exception.filter';
import { ActorResolverGuard } from './presentation/guards/actor-resolver.guard';

/**
 * Composition root for the cart/checkout/pricing/reservation-integration
 * domain (Phase 007 — see this module's README and
 * docs/adr/ADR-007-cart-checkout.md). Every port token below is bound to
 * its Prisma implementation here, same convention `catalog.module.ts`/
 * `inventory.module.ts` established.
 *
 * Imports `CatalogModule` and `InventoryModule` to reuse their exported
 * services directly (ADR-007 decisions 4 and 5) — `ProductsService`/
 * `SkusService`/`PricingService` for real catalog reads, and
 * `ReservationService`/`AllocationService`/`StockQueryService` for real
 * inventory reservation, rather than reimplementing any of that logic.
 * Imports `IdentityModule` for its exported `JwtTokenService`, used by
 * `ActorResolverGuard` to verify an *optional* Bearer token without
 * reimplementing JWT verification (see that guard's own doc comment for
 * why cart/checkout controllers are `@Public()` plus this custom guard
 * rather than the global `JwtAuthGuard`).
 *
 * `CART_REPOSITORY`/`CHECKOUT_SESSION_REPOSITORY` are the two
 * aggregate-root composite ports (Cart+CartItem+CartItemOption+
 * CartPriceSnapshot+CartCoupon+CartShippingSelection, and
 * CheckoutSession+CheckoutAddress+CheckoutTotals+
 * CheckoutValidationResult+CheckoutReservation respectively) — no
 * separate top-level port per child entity, mirroring the
 * `StockTransferRepositoryPort` precedent from Phase 006.
 *
 * Imports `CartCheckoutQueueModule` so the `checkout_expiration`/
 * `cart_abandonment` BullMQ sweeps (ADR-007 decision 3) actually get
 * registered on app bootstrap — see that module's own doc comment for why
 * it re-declares `CartService`/`CheckoutService` as separate instances
 * rather than importing this module back (would create a cycle).
 *
 * Exports `CheckoutService` and `ActorResolverGuard` (Phase 008 addition
 * — ADR-008 decision 10): `PaymentModule` imports this module to call
 * `CheckoutService.markConverted()` the moment a payment verifies (the
 * one place that module reaches back into cart-checkout, and only
 * through this real service), and reuses `ActorResolverGuard` directly
 * on its own customer/guest-facing routes — a payment intent's owner is
 * exactly its checkout session's owner, so re-verifying the same
 * optional-Bearer-token-or-guest-header logic a second time would be
 * duplicating this guard, not writing a new one. `ActorResolverGuard`'s
 * own dependencies (`JwtTokenService`, `CUSTOMER_LOOKUP_PORT`) must also
 * be resolvable wherever Nest re-instantiates the guard for a new
 * consuming module — `@UseGuards(SomeClass)` builds a fresh instance
 * scoped to the *controller's own* module, not a shared singleton reused
 * across module boundaries, so exporting the guard class alone is not
 * enough. `IdentityModule` (re-exported here) carries `JwtTokenService`
 * along; `CUSTOMER_LOOKUP_PORT` is exported directly since it's this
 * module's own binding.
 */
@Module({
  imports: [CatalogModule, InventoryModule, IdentityModule, CartCheckoutQueueModule],
  controllers: [CartController, CheckoutController],
  providers: [
    CartService,
    CheckoutService,
    CartPricingService,
    ActorResolverGuard,
    { provide: CART_REPOSITORY, useClass: PrismaCartRepository },
    { provide: SHIPPING_METHOD_REPOSITORY, useClass: PrismaShippingMethodRepository },
    { provide: CHECKOUT_SESSION_REPOSITORY, useClass: PrismaCheckoutSessionRepository },
    { provide: CUSTOMER_LOOKUP_PORT, useClass: PrismaCustomerLookupRepository },
    { provide: COUPON_LOOKUP_PORT, useClass: PrismaCouponLookupRepository },
    { provide: APP_FILTER, useClass: CartCheckoutDomainExceptionFilter },
  ],
  exports: [CheckoutService, ActorResolverGuard, CUSTOMER_LOOKUP_PORT, IdentityModule],
})
export class CartCheckoutModule {}
