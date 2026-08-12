import type { ProductSkuId, WarehouseId } from '@iecp/types';

import type { InventoryThreshold } from '../entities/inventory-threshold.entity';

export const INVENTORY_THRESHOLD_REPOSITORY = Symbol('INVENTORY_THRESHOLD_REPOSITORY');

export interface LowStockRow {
  threshold: InventoryThreshold;
  availableQuantity: number;
}

export interface InventoryThresholdRepositoryPort {
  findBySkuWarehouse(
    skuId: ProductSkuId,
    warehouseId: WarehouseId,
  ): Promise<InventoryThreshold | null>;
  /** Sums `InventoryItem.availableQuantity` across every location in the
   * warehouse for each thresholded SKU, evaluates `LowStockEvaluator`, and
   * returns only the rows currently low. */
  listLowStock(warehouseId?: WarehouseId): Promise<LowStockRow[]>;
  upsert(props: {
    productSkuId: string;
    warehouseId: string;
    reorderPoint?: number;
    safetyStock?: number;
    minStock?: number | null;
    maxStock?: number | null;
  }): Promise<InventoryThreshold>;
}
