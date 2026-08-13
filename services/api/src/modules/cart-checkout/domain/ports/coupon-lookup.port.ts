export const COUPON_LOOKUP_PORT = Symbol('COUPON_LOOKUP_PORT');

export interface CouponLookupResult {
  id: string;
  code: string;
  type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: bigint;
  minOrderAmount: bigint | null;
  maxDiscountAmount: bigint | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
}

/**
 * Minimal, Prisma-direct read of `marketing.coupons` — same minimal-port
 * precedent as `SkuLookupPort`/`CustomerLookupPort` (ADR-007 decision 8):
 * no `marketing` module's domain layer exists yet to import from, and this
 * module only ever *reads* a coupon's already-real rules, never mutates
 * one (redemption bookkeeping is out of scope this phase — see
 * `docs/product/cart-checkout.md`).
 */
export interface CouponLookupPort {
  findByCode(code: string): Promise<CouponLookupResult | null>;
  /** How many times this customer has already redeemed this coupon —
   * `marketing.coupon_redemptions`, read-only. Guests (no customerId)
   * always resolve to 0. */
  countRedemptionsByCustomer(couponId: string, customerId: string | null): Promise<number>;
}
