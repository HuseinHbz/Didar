import {
  asFulfillmentId,
  asOrderId,
  asWarehouseId,
  type FulfillmentId,
  type FulfillmentStatus,
  type OrderId,
  type WarehouseId,
} from '@iecp/types';

/** An `Order` may have many `Fulfillment` rows (partial fulfillment,
 * ADR-009 decision 8). `warehouseId` is an unenforced cross-schema
 * pointer, same convention every other commerce->inventory reference in
 * this schema uses. */
export class Fulfillment {
  private constructor(
    public readonly id: FulfillmentId,
    public readonly orderId: OrderId,
    public readonly status: FulfillmentStatus,
    public readonly warehouseId: WarehouseId | null,
    public readonly packedAt: Date | null,
    public readonly shippedAt: Date | null,
    public readonly deliveredAt: Date | null,
    public readonly cancelledAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    orderId: string;
    status?: FulfillmentStatus;
    warehouseId?: string | null;
    packedAt?: Date | null;
    shippedAt?: Date | null;
    deliveredAt?: Date | null;
    cancelledAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): Fulfillment {
    return new Fulfillment(
      asFulfillmentId(props.id),
      asOrderId(props.orderId),
      props.status ?? 'PENDING',
      props.warehouseId ? asWarehouseId(props.warehouseId) : null,
      props.packedAt ?? null,
      props.shippedAt ?? null,
      props.deliveredAt ?? null,
      props.cancelledAt ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }

  get isTerminal(): boolean {
    return this.status === 'DELIVERED' || this.status === 'CANCELLED';
  }
}
