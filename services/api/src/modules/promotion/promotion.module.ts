import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { CouponRedemptionService } from './application/coupon-redemption.service';
import { CouponService } from './application/coupon.service';
import { PromotionResolutionService } from './application/promotion-resolution.service';
import { PromotionService } from './application/promotion.service';
import { COUPON_REPOSITORY } from './domain/ports/coupon.repository.port';
import { CUSTOMER_CONTEXT_PORT } from './domain/ports/customer-context.port';
import { PROMOTION_REPOSITORY } from './domain/ports/promotion.repository.port';
import { PromotionQueueModule } from './infrastructure/queues/promotion-queue.module';
import { PrismaCouponRepository } from './infrastructure/repositories/prisma-coupon.repository';
import { PrismaCustomerContextRepository } from './infrastructure/repositories/prisma-customer-context.repository';
import { PrismaPromotionRepository } from './infrastructure/repositories/prisma-promotion.repository';
import { CouponAdminController } from './presentation/controllers/coupon-admin.controller';
import { PromotionAdminController } from './presentation/controllers/promotion-admin.controller';
import { PromotionDomainExceptionFilter } from './presentation/filters/promotion-domain-exception.filter';

/**
 * Composition root for the promotion/discount/coupon engine (Phase 010,
 * ADR-010). `cart-checkout`/`order` import this module directly and
 * inject `PromotionResolutionService`/`CouponRedemptionService` — the
 * same "next phase adds an additive hook to the previous phase's
 * service" composition pattern every prior phase used, not a network
 * hop or a duplicated implementation. Imports `PromotionQueueModule` so
 * the `promotion_expiration`/`coupon_reservation_cleanup` sweeps
 * (ADR-010 decision 9) actually get registered on app bootstrap.
 */
@Module({
  imports: [PromotionQueueModule],
  controllers: [PromotionAdminController, CouponAdminController],
  providers: [
    { provide: PROMOTION_REPOSITORY, useClass: PrismaPromotionRepository },
    { provide: COUPON_REPOSITORY, useClass: PrismaCouponRepository },
    { provide: CUSTOMER_CONTEXT_PORT, useClass: PrismaCustomerContextRepository },
    PromotionService,
    CouponService,
    PromotionResolutionService,
    CouponRedemptionService,
    { provide: APP_FILTER, useClass: PromotionDomainExceptionFilter },
  ],
  exports: [PromotionResolutionService, CouponRedemptionService, PromotionService, CouponService],
})
export class PromotionModule {}
