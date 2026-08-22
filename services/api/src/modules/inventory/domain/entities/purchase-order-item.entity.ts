import {
  asProductSkuId,
  asPurchaseOrderId,
  asPurchaseOrderItemId,
  type ProductSkuId,
  type PurchaseOrderId,
  type PurchaseOrderItemId,
} from '@iecp/types';

/** One SKU line on a `PurchaseOrder`. `receivedQuantity` is bookkeeping
 * for "how much of this line has physically arrived so far" — never a
 * second source of truth for stock (`InventoryItem`/`InventoryLedger`
 * remain that). Database-enforced (not just here): `orderedQuantity > 0`,
 * `unitCost >= 0`, `0 <= receivedQuantity <= orderedQuantity` — real
 * Postgres CHECK constraints, not application-only guards. */
export class PurchaseOrderItem {
  private constructor(
    public readonly id: PurchaseOrderItemId,
    public readonly purchaseOrderId: PurchaseOrderId,
    public readonly productSkuId: ProductSkuId,
    public readonly orderedQuantity: number,
    public readonly receivedQuantity: number,
    public readonly unitCost: bigint,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    purchaseOrderId: string;
    productSkuId: string;
    orderedQuantity: number;
    receivedQuantity?: number;
    unitCost: bigint;
    createdAt: Date;
    updatedAt: Date;
  }): PurchaseOrderItem {
    return new PurchaseOrderItem(
      asPurchaseOrderItemId(props.id),
      asPurchaseOrderId(props.purchaseOrderId),
      asProductSkuId(props.productSkuId),
      props.orderedQuantity,
      props.receivedQuantity ?? 0,
      props.unitCost,
      props.createdAt,
      props.updatedAt,
    );
  }

  /** How much of this line is still owed by the supplier. */
  get outstandingQuantity(): number {
    return this.orderedQuantity - this.receivedQuantity;
  }

  get isFullyReceived(): boolean {
    return this.receivedQuantity >= this.orderedQuantity;
  }
}
