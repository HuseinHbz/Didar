import {
  asOrderExceptionId,
  asOrderId,
  type OrderExceptionId,
  type OrderExceptionResolution,
  type OrderExceptionStatus,
  type OrderExceptionType,
  type OrderId,
} from '@iecp/types';

/**
 * A durable, blocking work item: why a *paid* order cannot proceed on its own
 * (CP-031, gap P0-5 — docs/adr/ADR-031-payment-order-consistency.md). Today
 * only `STOCK_SHORTFALL`: the customer has paid and the order exists, but the
 * stock for one of its lines could not be allocated.
 *
 * While any exception for an order is `OPEN`, the order cannot be approved
 * (`OrderExceptionPolicy`), so an order with no stock behind it can never
 * reach fulfillment. Rows are never deleted; closing one records how
 * (`resolution`), who (`resolvedBy`, null = the system) and when.
 */
export class OrderException {
  private constructor(
    public readonly id: OrderExceptionId,
    public readonly orderId: OrderId,
    public readonly type: OrderExceptionType,
    public readonly status: OrderExceptionStatus,
    public readonly productSkuId: string | null,
    public readonly requestedQuantity: number | null,
    public readonly dedupeKey: string,
    public readonly detail: Record<string, unknown> | null,
    public readonly openedAt: Date,
    public readonly resolvedAt: Date | null,
    public readonly resolution: OrderExceptionResolution | null,
    public readonly resolvedBy: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    orderId: string;
    type: OrderExceptionType;
    status: OrderExceptionStatus;
    productSkuId: string | null;
    requestedQuantity: number | null;
    dedupeKey: string;
    detail: Record<string, unknown> | null;
    openedAt: Date;
    resolvedAt: Date | null;
    resolution: OrderExceptionResolution | null;
    resolvedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): OrderException {
    return new OrderException(
      asOrderExceptionId(props.id),
      asOrderId(props.orderId),
      props.type,
      props.status,
      props.productSkuId,
      props.requestedQuantity,
      props.dedupeKey,
      props.detail,
      props.openedAt,
      props.resolvedAt,
      props.resolution,
      props.resolvedBy,
      props.createdAt,
      props.updatedAt,
    );
  }

  get isOpen(): boolean {
    return this.status === 'OPEN';
  }
}
