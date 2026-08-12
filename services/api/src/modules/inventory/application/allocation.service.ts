import { asWarehouseId, type AllocationResult, type ProductSkuId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import {
  ALLOCATION_RULES_REPOSITORY,
  type AllocationRulesRepositoryPort,
} from '../domain/ports/allocation-rules.repository.port';
import {
  INVENTORY_ITEM_REPOSITORY,
  type InventoryItemRepositoryPort,
} from '../domain/ports/inventory-item.repository.port';
import {
  WAREHOUSE_REPOSITORY,
  type WarehouseRepositoryPort,
} from '../domain/ports/warehouse.repository.port';
import {
  AllocationEngine,
  type AllocationCandidate,
  type AllocationContext,
} from '../domain/services/allocation-engine';

/**
 * Wraps the pure `AllocationEngine` with the I/O it needs: candidate stock
 * per warehouse (`InventoryItemRepositoryPort.listBySku`), warehouse
 * metadata (store vs. warehouse, for `PREFERRED_STORE`/`CLICK_AND_COLLECT`),
 * and the configured rule order (`system.Setting`, ADR-006 decision 7).
 * `allocate()` only *picks* a warehouse — it never reserves anything
 * itself, so a caller (e.g. a future cart/checkout module) must still go
 * through `ReservationService.reserve()` with the chosen `warehouseId`
 * (the brief's "allocation must not bypass reservation logic").
 */
@Injectable()
export class AllocationService {
  constructor(
    @Inject(INVENTORY_ITEM_REPOSITORY) private readonly items: InventoryItemRepositoryPort,
    @Inject(WAREHOUSE_REPOSITORY) private readonly warehouses: WarehouseRepositoryPort,
    @Inject(ALLOCATION_RULES_REPOSITORY) private readonly rules: AllocationRulesRepositoryPort,
  ) {}

  async allocate(
    productSkuId: ProductSkuId,
    context: AllocationContext,
  ): Promise<AllocationResult> {
    const stockRows = await this.items.listBySku(productSkuId);
    const byWarehouse = new Map<string, number>();
    for (const row of stockRows) {
      byWarehouse.set(
        row.warehouseId,
        (byWarehouse.get(row.warehouseId) ?? 0) + row.availableQuantity,
      );
    }
    const locationByWarehouse = new Map<string, string>();
    for (const row of stockRows) {
      if (!locationByWarehouse.has(row.warehouseId))
        locationByWarehouse.set(row.warehouseId, row.locationId);
    }

    const candidates: AllocationCandidate[] = [];
    for (const [warehouseId, availableQuantity] of byWarehouse) {
      const warehouse = await this.warehouses.findById(asWarehouseId(warehouseId));
      if (!warehouse?.isUsable) continue;
      candidates.push({
        warehouseId,
        locationId: locationByWarehouse.get(warehouseId) ?? '',
        availableQuantity,
        isStore: warehouse.type === 'STORE' || warehouse.type === 'DARK_STORE',
      });
    }

    const configuredRules = await this.rules.get();
    return AllocationEngine.allocate(candidates, configuredRules, context);
  }
}
