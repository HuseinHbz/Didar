import {
  asOrderId,
  asOrderStatusHistoryId,
  asUserId,
  type OrderId,
  type OrderStatus,
  type OrderStatusHistoryId,
  type UserId,
} from '@iecp/types';

/** Append-only — `changedBy = null` means a system-generated transition
 * (the `order_conversion`/`order_expiration` sweeps), same convention
 * `system.AuditLog.actorId` already uses; never a fabricated actor row. */
export class OrderStatusHistory {
  private constructor(
    public readonly id: OrderStatusHistoryId,
    public readonly orderId: OrderId,
    public readonly fromStatus: OrderStatus | null,
    public readonly toStatus: OrderStatus,
    public readonly changedBy: UserId | null,
    public readonly note: string | null,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    orderId: string;
    fromStatus?: OrderStatus | null;
    toStatus: OrderStatus;
    changedBy?: string | null;
    note?: string | null;
    createdAt: Date;
  }): OrderStatusHistory {
    return new OrderStatusHistory(
      asOrderStatusHistoryId(props.id),
      asOrderId(props.orderId),
      props.fromStatus ?? null,
      props.toStatus,
      props.changedBy ? asUserId(props.changedBy) : null,
      props.note ?? null,
      props.createdAt,
    );
  }
}
