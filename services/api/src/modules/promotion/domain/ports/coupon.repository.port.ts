import type { CouponStatus, RedemptionStatus } from '@iecp/types';

import type { CouponRedemption } from '../entities/coupon-redemption.entity';
import type { Coupon } from '../entities/coupon.entity';

export const COUPON_REPOSITORY = Symbol('COUPON_REPOSITORY');

export interface CreateCouponInput {
  promotionId: string;
  code: string;
  startsAt: Date | null;
  expiresAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  metadata: Record<string, unknown> | null;
}

export interface CouponRepositoryPort {
  create(input: CreateCouponInput): Promise<Coupon>;
  findById(id: string): Promise<Coupon | null>;
  /** `code` must already be normalized (`CouponCode.normalize()`) by the
   * caller — this port never normalizes, so every caller's intent is
   * explicit. */
  findByCode(code: string): Promise<Coupon | null>;
  listByPromotion(promotionId: string): Promise<Coupon[]>;
  updateStatus(id: string, status: CouponStatus): Promise<Coupon>;
  listExpiredNotMarked(now: Date): Promise<Coupon[]>;

  /**
   * ADR-010 decision 8 — the one concurrency-critical write. Row-locks
   * the coupon (if `couponId` set) or the promotion (couponless path)
   * inside a transaction, re-sums already-active (`RESERVED`/`REDEEMED`)
   * redemptions for that coupon/promotion (global) and for `customerId`
   * (per-customer), and only then inserts the new `RESERVED` row and
   * bumps the cached `usageCount` — never a bare check-then-insert.
   * Throws `CouponUsageLimitExceededError` if capacity is exhausted.
   * Re-reserving the same `(checkoutSessionId, promotionId)` pair
   * upserts the existing row's `discountAmount` rather than creating a
   * second one (`@@unique` in the schema).
   */
  reserve(input: {
    promotionId: string;
    couponId: string | null;
    customerId: string | null;
    guestToken: string | null;
    checkoutSessionId: string;
    discountAmount: bigint;
    promotionUsageLimit: number | null;
    promotionPerCustomerLimit: number | null;
    couponUsageLimit: number | null;
    couponPerCustomerLimit: number | null;
  }): Promise<CouponRedemption>;

  /** Order conversion (PAID transition) — every `RESERVED` redemption for
   * this checkout becomes `REDEEMED`, `orderId` set. Idempotent: a
   * redemption already `REDEEMED` for this order is left unchanged. */
  finalize(checkoutSessionId: string, orderId: string): Promise<CouponRedemption[]>;

  /** Checkout cancel/expire, or the `coupon_reservation_cleanup` sweep —
   * every `RESERVED` redemption for this checkout becomes `RELEASED`,
   * decrementing the cached `usageCount` back down. Idempotent. */
  release(checkoutSessionId: string): Promise<CouponRedemption[]>;

  listByCheckout(checkoutSessionId: string): Promise<CouponRedemption[]>;
  countByCustomer(
    promotionId: string,
    couponId: string | null,
    customerId: string,
  ): Promise<number>;

  /** The `coupon_reservation_cleanup` sweep's own read (ADR-010 decision
   * 9) — every `RESERVED` row older than `olderThan`. */
  listStaleReservations(olderThan: Date): Promise<CouponRedemption[]>;
}

export type { RedemptionStatus };
