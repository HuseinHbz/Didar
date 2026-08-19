import {
  asOrderId,
  asOrderItemId,
  asProductSkuId,
  type OrderId,
  type OrderItemId,
  type ProductSkuId,
} from '@iecp/types';

/** Immutable snapshot (ADR-009 decision 1, blueprint §17/§25 "order ≠ live
 * product") — `skuSnapshot`/`nameSnapshot`/`unitPriceSnapshot`/
 * `discountAmount`/`taxAmount` are copied once, at order creation, from
 * the checkout's own already-frozen pricing breakdown. `productSkuId` is
 * nullable since the live SKU may later be deleted; the snapshot fields
 * carry the historical truth regardless. */
export class OrderItem {
  private constructor(
    public readonly id: OrderItemId,
    public readonly orderId: OrderId,
    public readonly productSkuId: ProductSkuId | null,
    public readonly skuSnapshot: string,
    public readonly nameSnapshot: string,
    public readonly unitPriceSnapshot: bigint,
    public readonly quantity: number,
    public readonly discountAmount: bigint,
    public readonly taxAmount: bigint,
    public readonly lineTotal: bigint,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    orderId: string;
    productSkuId?: string | null;
    skuSnapshot: string;
    nameSnapshot: string;
    unitPriceSnapshot: bigint;
    quantity: number;
    discountAmount?: bigint;
    taxAmount?: bigint;
    lineTotal: bigint;
    createdAt: Date;
  }): OrderItem {
    return new OrderItem(
      asOrderItemId(props.id),
      asOrderId(props.orderId),
      props.productSkuId ? asProductSkuId(props.productSkuId) : null,
      props.skuSnapshot,
      props.nameSnapshot,
      props.unitPriceSnapshot,
      props.quantity,
      props.discountAmount ?? 0n,
      props.taxAmount ?? 0n,
      props.lineTotal,
      props.createdAt,
    );
  }
}
