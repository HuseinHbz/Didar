import type { InventoryAdjustmentType, ProductSkuId, WarehouseId } from '@iecp/types';

import type { InventoryAdjustment } from '../entities/inventory-adjustment.entity';

export const INVENTORY_ADJUSTMENT_REPOSITORY = Symbol('INVENTORY_ADJUSTMENT_REPOSITORY');

export interface InventoryAdjustmentRepositoryPort {
  findById(id: string): Promise<InventoryAdjustment | null>;
  listByWarehouse(
    warehouseId: WarehouseId,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: InventoryAdjustment[]; nextCursor: string | null }>;
  /** Transactional: row-locks the target item, validates via
   * `AdjustmentValidator`, applies the signed delta to `onHandQuantity`,
   * writes both the `InventoryAdjustment` row and an `ADJUSTMENT` ledger
   * entry in the same transaction. */
  create(props: {
    warehouseId: WarehouseId;
    locationId: string;
    productSkuId: ProductSkuId;
    adjustmentType: InventoryAdjustmentType;
    quantity: number;
    reason: string;
    approvedBy?: string | null;
    createdBy: string;
    correlationId: string;
  }): Promise<InventoryAdjustment>;
}
