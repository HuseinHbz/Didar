import type { ProductSkuId, WarehouseId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import type { InventoryThreshold } from '../domain/entities/inventory-threshold.entity';
import {
  INVENTORY_THRESHOLD_REPOSITORY,
  type InventoryThresholdRepositoryPort,
  type LowStockRow,
} from '../domain/ports/inventory-threshold.repository.port';

/** Thresholds always come from the database — never hardcoded (the
 * brief's own critical_rule) — and can vary per SKU + warehouse. */
@Injectable()
export class LowStockService {
  constructor(
    @Inject(INVENTORY_THRESHOLD_REPOSITORY)
    private readonly thresholds: InventoryThresholdRepositoryPort,
  ) {}

  listLowStock(warehouseId?: WarehouseId): Promise<LowStockRow[]> {
    return this.thresholds.listLowStock(warehouseId);
  }

  setThreshold(input: {
    productSkuId: ProductSkuId;
    warehouseId: WarehouseId;
    reorderPoint?: number;
    safetyStock?: number;
    minStock?: number | null;
    maxStock?: number | null;
  }): Promise<InventoryThreshold> {
    return this.thresholds.upsert(input);
  }
}
