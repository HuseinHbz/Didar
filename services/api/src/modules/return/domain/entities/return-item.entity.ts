import {
  asOrderItemId,
  asReturnItemId,
  asReturnRequestId,
  type OrderItemId,
  type ReturnItemCondition,
  type ReturnItemId,
  type ReturnRequestId,
} from '@iecp/types';

/** References a concrete `OrderItem`, never a bare SKU (same discipline
 * `FulfillmentItem` already uses). `condition` is set at `INSPECTING`;
 * `refundAmount` is computed once, server-side, by
 * `RefundAmountCalculator` from `OrderItem`'s own immutable snapshot at
 * `APPROVED_FOR_REFUND` — never client-supplied, never recomputed from
 * the live catalog. */
export class ReturnItem {
  private constructor(
    public readonly id: ReturnItemId,
    public readonly returnRequestId: ReturnRequestId,
    public readonly orderItemId: OrderItemId,
    public readonly quantity: number,
    public readonly condition: ReturnItemCondition | null,
    public readonly refundAmount: bigint | null,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    returnRequestId: string;
    orderItemId: string;
    quantity: number;
    condition?: ReturnItemCondition | null;
    refundAmount?: bigint | null;
    createdAt: Date;
  }): ReturnItem {
    return new ReturnItem(
      asReturnItemId(props.id),
      asReturnRequestId(props.returnRequestId),
      asOrderItemId(props.orderItemId),
      props.quantity,
      props.condition ?? null,
      props.refundAmount ?? null,
      props.createdAt,
    );
  }
}
