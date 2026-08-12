import {
  asInventoryAdjustmentId,
  asProductSkuId,
  asUserId,
  asWarehouseId,
  asWarehouseLocationId,
  type InventoryAdjustmentId,
  type InventoryAdjustmentType,
  type ProductSkuId,
  type UserId,
  type WarehouseId,
  type WarehouseLocationId,
} from '@iecp/types';

/** A one-off manual correction outside the reservation/transfer/count
 * flows — permission-controlled and audited. */
export class InventoryAdjustment {
  private constructor(
    public readonly id: InventoryAdjustmentId,
    public readonly warehouseId: WarehouseId,
    public readonly locationId: WarehouseLocationId,
    public readonly productSkuId: ProductSkuId,
    public readonly adjustmentType: InventoryAdjustmentType,
    public readonly quantity: number,
    public readonly reason: string,
    public readonly approvedBy: UserId | null,
    public readonly createdBy: UserId,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    warehouseId: string;
    locationId: string;
    productSkuId: string;
    adjustmentType: InventoryAdjustmentType;
    quantity: number;
    reason: string;
    approvedBy?: string | null;
    createdBy: string;
    createdAt: Date;
  }): InventoryAdjustment {
    return new InventoryAdjustment(
      asInventoryAdjustmentId(props.id),
      asWarehouseId(props.warehouseId),
      asWarehouseLocationId(props.locationId),
      asProductSkuId(props.productSkuId),
      props.adjustmentType,
      props.quantity,
      props.reason,
      props.approvedBy ? asUserId(props.approvedBy) : null,
      asUserId(props.createdBy),
      props.createdAt,
    );
  }

  /** Signed delta this adjustment applies to on-hand quantity. */
  get signedQuantity(): number {
    return this.adjustmentType === 'POSITIVE' ? this.quantity : -this.quantity;
  }
}
