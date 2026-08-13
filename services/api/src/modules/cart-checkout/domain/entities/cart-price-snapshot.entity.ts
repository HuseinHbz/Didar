import {
  asCartId,
  asCartPriceSnapshotId,
  type CartId,
  type CartPriceSnapshotId,
} from '@iecp/types';

import type { PriceLineBreakdown } from './price-breakdown.types';

/** Append-only — one row per `price()` recalculation of a cart (ADR-007
 * decision 2). Never updated, never deleted. */
export class CartPriceSnapshot {
  private constructor(
    public readonly id: CartPriceSnapshotId,
    public readonly cartId: CartId,
    public readonly currency: string,
    public readonly subtotal: bigint,
    public readonly discountTotal: bigint,
    public readonly taxTotal: bigint,
    public readonly shippingTotal: bigint,
    public readonly grandTotal: bigint,
    public readonly breakdown: readonly PriceLineBreakdown[],
    public readonly calculatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    cartId: string;
    currency: string;
    subtotal: bigint;
    discountTotal: bigint;
    taxTotal: bigint;
    shippingTotal: bigint;
    grandTotal: bigint;
    breakdown: readonly PriceLineBreakdown[];
    calculatedAt: Date;
  }): CartPriceSnapshot {
    return new CartPriceSnapshot(
      asCartPriceSnapshotId(props.id),
      asCartId(props.cartId),
      props.currency,
      props.subtotal,
      props.discountTotal,
      props.taxTotal,
      props.shippingTotal,
      props.grandTotal,
      props.breakdown,
      props.calculatedAt,
    );
  }
}
