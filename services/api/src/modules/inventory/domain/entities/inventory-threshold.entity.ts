import {
  asInventoryThresholdId,
  asProductSkuId,
  asWarehouseId,
  type InventoryThresholdId,
  type ProductSkuId,
  type WarehouseId,
} from '@iecp/types';

/** Low-stock thresholds — per SKU + warehouse, deliberately decoupled from
 * location (ADR-006 decision 6). Admin-configurable, never hardcoded. */
export class InventoryThreshold {
  private constructor(
    public readonly id: InventoryThresholdId,
    public readonly productSkuId: ProductSkuId,
    public readonly warehouseId: WarehouseId,
    public readonly reorderPoint: number,
    public readonly safetyStock: number,
    public readonly minStock: number | null,
    public readonly maxStock: number | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    productSkuId: string;
    warehouseId: string;
    reorderPoint?: number;
    safetyStock?: number;
    minStock?: number | null;
    maxStock?: number | null;
    createdAt: Date;
    updatedAt: Date;
  }): InventoryThreshold {
    return new InventoryThreshold(
      asInventoryThresholdId(props.id),
      asProductSkuId(props.productSkuId),
      asWarehouseId(props.warehouseId),
      props.reorderPoint ?? 0,
      props.safetyStock ?? 0,
      props.minStock ?? null,
      props.maxStock ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }
}
