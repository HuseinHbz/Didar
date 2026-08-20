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
 * `FulfillmentItem` already uses). `condition` and `refundAmount` are
 * both set together at `INSPECTING` (`ReturnService.inspect()`):
 * `condition` is the physical inspection outcome, and `refundAmount` is
 * computed the same moment, server-side, by `RefundAmountCalculator`
 * from `OrderItem`'s own immutable snapshot — never client-supplied,
 * never recomputed from the live catalog. The refund amount does not
 * depend on the accept/reject decision that follows at
 * `INSPECTING -> APPROVED_FOR_REFUND`/`REJECTED`: a line's payable
 * amount is a pure function of what was ordered and already returned,
 * not of the physical condition found. */
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
