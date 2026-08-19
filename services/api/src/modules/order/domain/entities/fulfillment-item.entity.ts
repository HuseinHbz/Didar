import {
  asFulfillmentId,
  asFulfillmentItemId,
  asOrderItemId,
  type FulfillmentId,
  type FulfillmentItemId,
  type OrderItemId,
} from '@iecp/types';

/** References a concrete `OrderItem`, never a bare SKU string (ADR-009
 * decision 8). */
export class FulfillmentItem {
  private constructor(
    public readonly id: FulfillmentItemId,
    public readonly fulfillmentId: FulfillmentId,
    public readonly orderItemId: OrderItemId,
    public readonly quantity: number,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    fulfillmentId: string;
    orderItemId: string;
    quantity: number;
    createdAt: Date;
  }): FulfillmentItem {
    return new FulfillmentItem(
      asFulfillmentItemId(props.id),
      asFulfillmentId(props.fulfillmentId),
      asOrderItemId(props.orderItemId),
      props.quantity,
      props.createdAt,
    );
  }
}
