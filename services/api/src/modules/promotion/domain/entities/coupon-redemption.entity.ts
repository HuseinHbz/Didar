import { asCouponRedemptionId, type CouponRedemptionId, type RedemptionStatus } from '@iecp/types';

/** ADR-010 decision 8 — one ledger row per (checkoutSession, promotion)
 * pair, `RESERVED -> REDEEMED|RELEASED`, never deleted. */
export class CouponRedemption {
  constructor(
    public readonly id: CouponRedemptionId,
    public readonly promotionId: string,
    public readonly couponId: string | null,
    public readonly customerId: string | null,
    public readonly guestToken: string | null,
    public readonly checkoutSessionId: string,
    public readonly orderId: string | null,
    public readonly status: RedemptionStatus,
    public readonly discountAmount: bigint,
  ) {}

  static fromPersistence(row: {
    id: string;
    promotionId: string;
    couponId: string | null;
    customerId: string | null;
    guestToken: string | null;
    checkoutSessionId: string;
    orderId: string | null;
    status: RedemptionStatus;
    discountAmount: bigint;
  }): CouponRedemption {
    return new CouponRedemption(
      asCouponRedemptionId(row.id),
      row.promotionId,
      row.couponId,
      row.customerId,
      row.guestToken,
      row.checkoutSessionId,
      row.orderId,
      row.status,
      row.discountAmount,
    );
  }
}
