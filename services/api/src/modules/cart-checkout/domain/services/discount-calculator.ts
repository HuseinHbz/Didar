import { Money } from '@iecp/types';

export interface CouponRule {
  type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  /** Basis points (PERCENTAGE) or a Rial amount (FIXED_AMOUNT) — same
   * dual-meaning-by-type convention `marketing.coupons.value` already
   * uses (Phase 003). */
  value: bigint;
  minOrderAmount: bigint | null;
  maxDiscountAmount: bigint | null;
}

export class CouponNotApplicableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CouponNotApplicableError';
  }
}

/**
 * Resolves a cart-level coupon into a total discount amount, then
 * allocates it proportionally across lines by each line's share of the
 * cart subtotal — deterministic, floor-rounded per line (BigInt division
 * truncates toward zero), with any leftover Rial from rounding assigned to
 * the *last* line so the sum of per-line discounts always exactly equals
 * the total discount (never off by a few Rial from naive per-line
 * rounding). ADR-007 decision 8: never re-derives coupon rules itself —
 * `CouponRule` is read from the real `marketing.coupons` row by the
 * application layer and passed in here as already-resolved input.
 */
export class DiscountCalculator {
  static calculateTotalDiscount(subtotal: bigint, coupon: CouponRule): bigint {
    if (coupon.minOrderAmount !== null && subtotal < coupon.minOrderAmount) {
      throw new CouponNotApplicableError(
        `Order subtotal below the coupon's minimum order amount of ${coupon.minOrderAmount.toString()}`,
      );
    }
    let discount =
      coupon.type === 'PERCENTAGE'
        ? Money.ofRial(subtotal).applyBasisPoints(Number(coupon.value)).amount
        : coupon.value;
    if (discount > subtotal) discount = subtotal;
    if (coupon.maxDiscountAmount !== null && discount > coupon.maxDiscountAmount) {
      discount = coupon.maxDiscountAmount;
    }
    return discount;
  }

  static allocateByLineShare(
    totalDiscount: bigint,
    lines: readonly { lineSubtotal: bigint }[],
    cartSubtotal: bigint,
  ): bigint[] {
    if (cartSubtotal === 0n || lines.length === 0) return lines.map(() => 0n);
    const allocations = lines.map((line) => (totalDiscount * line.lineSubtotal) / cartSubtotal);
    const allocatedSum = allocations.reduce((sum, value) => sum + value, 0n);
    const remainder = totalDiscount - allocatedSum;
    if (remainder !== 0n && allocations.length > 0) {
      allocations[allocations.length - 1] = (allocations[allocations.length - 1] ?? 0n) + remainder;
    }
    return allocations;
  }
}
