import {
  asCheckoutSessionId,
  asCheckoutTotalsId,
  type CheckoutSessionId,
  type CheckoutTotalsId,
} from '@iecp/types';

import type { PriceLineBreakdown } from './price-breakdown.types';

/** Append-only — one row per `POST /checkout/:id/price` recalculation
 * (ADR-007 decision 2). */
export class CheckoutTotals {
  private constructor(
    public readonly id: CheckoutTotalsId,
    public readonly checkoutSessionId: CheckoutSessionId,
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
    checkoutSessionId: string;
    currency: string;
    subtotal: bigint;
    discountTotal: bigint;
    taxTotal: bigint;
    shippingTotal: bigint;
    grandTotal: bigint;
    breakdown: readonly PriceLineBreakdown[];
    calculatedAt: Date;
  }): CheckoutTotals {
    return new CheckoutTotals(
      asCheckoutTotalsId(props.id),
      asCheckoutSessionId(props.checkoutSessionId),
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
