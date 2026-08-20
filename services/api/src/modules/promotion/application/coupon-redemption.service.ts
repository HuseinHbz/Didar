import { Inject, Injectable } from '@nestjs/common';

import type { CouponRedemption } from '../domain/entities/coupon-redemption.entity';
import {
  COUPON_REPOSITORY,
  type CouponRepositoryPort,
} from '../domain/ports/coupon.repository.port';
import {
  PROMOTION_REPOSITORY,
  type PromotionRepositoryPort,
} from '../domain/ports/promotion.repository.port';

/** The minimal shape `reserveAll` needs from an accepted adjustment —
 * deliberately decoupled from `ResolvedPromotionAdjustment` (the pure
 * resolver's own richer output) so callers outside the promotion module
 * (`CartPricingService`'s JSON-friendly `AppliedPromotionSnapshot`) don't
 * need to depend on the domain resolver's exact type. */
export interface AcceptedAdjustmentInput {
  promotionId: string;
  couponId: string | null;
  discountAmount: bigint;
}

/**
 * ADR-010 decision 8 — the redemption lifecycle orchestrator: `reserveAll`
 * is called at checkout `readyForPayment()` (freezes the resolution and
 * claims capacity for every accepted promotion in one call, each through
 * `CouponRepositoryPort.reserve()`'s own row-locked, database-enforced
 * check), `finalize` at order conversion (PAID transition), `release` on
 * checkout cancel/expire and by the `coupon_reservation_cleanup` sweep.
 */
@Injectable()
export class CouponRedemptionService {
  constructor(
    @Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepositoryPort,
    @Inject(PROMOTION_REPOSITORY) private readonly promotions: PromotionRepositoryPort,
  ) {}

  async reserveAll(input: {
    checkoutSessionId: string;
    customerId: string | null;
    guestToken: string | null;
    accepted: readonly AcceptedAdjustmentInput[];
  }): Promise<CouponRedemption[]> {
    const reserved: CouponRedemption[] = [];
    for (const adjustment of input.accepted) {
      const promotion = await this.promotions.findById(adjustment.promotionId);
      if (!promotion) continue;
      const coupon = adjustment.couponId ? await this.coupons.findById(adjustment.couponId) : null;
      const redemption = await this.coupons.reserve({
        promotionId: adjustment.promotionId,
        couponId: adjustment.couponId,
        customerId: input.customerId,
        guestToken: input.guestToken,
        checkoutSessionId: input.checkoutSessionId,
        discountAmount: adjustment.discountAmount,
        promotionUsageLimit: promotion.usageLimit,
        promotionPerCustomerLimit: promotion.perCustomerLimit,
        couponUsageLimit: coupon?.usageLimit ?? null,
        couponPerCustomerLimit: coupon?.perCustomerLimit ?? null,
      });
      reserved.push(redemption);
    }
    return reserved;
  }

  async finalize(checkoutSessionId: string, orderId: string): Promise<CouponRedemption[]> {
    return this.coupons.finalize(checkoutSessionId, orderId);
  }

  async release(checkoutSessionId: string): Promise<CouponRedemption[]> {
    return this.coupons.release(checkoutSessionId);
  }

  async listByCheckout(checkoutSessionId: string): Promise<CouponRedemption[]> {
    return this.coupons.listByCheckout(checkoutSessionId);
  }
}
