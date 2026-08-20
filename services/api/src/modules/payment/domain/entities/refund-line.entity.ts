import {
  asRefundId,
  asRefundLineId,
  asReturnItemId,
  type RefundId,
  type RefundLineId,
  type ReturnItemId,
} from '@iecp/types';

/** The per-`ReturnItem` breakdown of one `Refund`'s total `amount`
 * (ADR-012 decision 8) — a child entity with no independent lifecycle,
 * same shape `OrderItem`/`FulfillmentItem` already use. Only ever
 * written, in the same transaction as its parent `Refund` row, for a
 * return-triggered refund; a direct/order-level refund
 * (`OrderService.cancel()`/`.requestPartialRefund()`) has no lines. Each
 * line's `amount` comes straight from
 * `RefundAmountCalculator.amountForReturnedUnits()` — never
 * client-supplied, and the lines always sum to their parent `Refund
 * .amount` exactly (no rounding leakage, by construction). */
export class RefundLine {
  private constructor(
    public readonly id: RefundLineId,
    public readonly refundId: RefundId,
    public readonly returnItemId: ReturnItemId,
    public readonly amount: bigint,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    refundId: string;
    returnItemId: string;
    amount: bigint;
    createdAt: Date;
  }): RefundLine {
    return new RefundLine(
      asRefundLineId(props.id),
      asRefundId(props.refundId),
      asReturnItemId(props.returnItemId),
      props.amount,
      props.createdAt,
    );
  }
}
