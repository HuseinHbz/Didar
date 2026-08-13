import { asCartCouponId, asCartId, type CartCouponId, type CartId } from '@iecp/types';

/** One coupon per cart — `couponId` is an unenforced pointer to
 * `marketing.coupons.id` (ADR-007 decision 8); `resolvedDiscount` is the
 * amount computed and snapshotted at apply-time, re-validated (never
 * blindly re-trusted) on every subsequent price recalculation. */
export class CartCoupon {
  private constructor(
    public readonly id: CartCouponId,
    public readonly cartId: CartId,
    public readonly couponId: string,
    public readonly code: string,
    public readonly resolvedDiscount: bigint,
    public readonly appliedAt: Date,
  ) {}

  static create(props: {
    id: string;
    cartId: string;
    couponId: string;
    code: string;
    resolvedDiscount: bigint;
    appliedAt: Date;
  }): CartCoupon {
    return new CartCoupon(
      asCartCouponId(props.id),
      asCartId(props.cartId),
      props.couponId,
      props.code,
      props.resolvedDiscount,
      props.appliedAt,
    );
  }
}
