import { asCouponId, type CouponId, type CouponStatus } from '@iecp/types';

/** A separate aggregate that unlocks a `Promotion` (ADR-010 decision 1) —
 * its own status lifecycle and usage limits, layered on top of the
 * promotion's own. */
export class Coupon {
  constructor(
    public readonly id: CouponId,
    public readonly promotionId: string,
    public readonly code: string,
    public readonly status: CouponStatus,
    public readonly startsAt: Date | null,
    public readonly expiresAt: Date | null,
    public readonly usageLimit: number | null,
    public readonly usageCount: number,
    public readonly perCustomerLimit: number | null,
    public readonly metadata: Record<string, unknown> | null,
  ) {}

  isWithinWindow(now: Date): boolean {
    if (this.startsAt && now < this.startsAt) return false;
    if (this.expiresAt && now > this.expiresAt) return false;
    return true;
  }

  isUsable(now: Date): boolean {
    return this.status === 'ACTIVE' && this.isWithinWindow(now);
  }

  static fromPersistence(row: {
    id: string;
    promotionId: string;
    code: string;
    status: CouponStatus;
    startsAt: Date | null;
    expiresAt: Date | null;
    usageLimit: number | null;
    usageCount: number;
    perCustomerLimit: number | null;
    metadata: unknown;
  }): Coupon {
    return new Coupon(
      asCouponId(row.id),
      row.promotionId,
      row.code,
      row.status,
      row.startsAt,
      row.expiresAt,
      row.usageLimit,
      row.usageCount,
      row.perCustomerLimit,
      (row.metadata as Record<string, unknown> | null) ?? null,
    );
  }
}
