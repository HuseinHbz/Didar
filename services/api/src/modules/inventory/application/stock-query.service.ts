import type { ProductSkuId, WarehouseId } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { InventoryItem } from '../domain/entities/inventory-item.entity';
import {
  INVENTORY_ITEM_REPOSITORY,
  type InventoryItemRepositoryPort,
  type StockBySkuRow,
} from '../domain/ports/inventory-item.repository.port';
import {
  SKU_LOOKUP_PORT,
  type SkuLookupPort,
  type SkuLookupResult,
} from '../domain/ports/sku-lookup.port';
import {
  WAREHOUSE_REPOSITORY,
  type WarehouseRepositoryPort,
} from '../domain/ports/warehouse.repository.port';

export interface SkuAvailability {
  productSkuId: ProductSkuId;
  totalAvailableQuantity: number;
  byWarehouse: StockBySkuRow[];
}

/**
 * The read surface both `GET /internal/inventory/availability/:skuId`
 * (Phase 007's future cart/checkout integration seam) and the storefront
 * public availability endpoints sit on top of. Always reads
 * `InventoryItem`'s cached quantity columns — this is the one place
 * "PostgreSQL is the single source of truth" is exercised on every call
 * (root `CLAUDE.md`'s non-negotiable rule): never Redis, never OpenSearch.
 */
@Injectable()
export class StockQueryService {
  constructor(
    @Inject(INVENTORY_ITEM_REPOSITORY) private readonly items: InventoryItemRepositoryPort,
    @Inject(WAREHOUSE_REPOSITORY) private readonly warehouses: WarehouseRepositoryPort,
    @Inject(SKU_LOOKUP_PORT) private readonly skuLookup: SkuLookupPort,
  ) {}

  async getAvailability(skuId: ProductSkuId): Promise<SkuAvailability> {
    const byWarehouse = await this.items.listBySku(skuId);
    return {
      productSkuId: skuId,
      totalAvailableQuantity: byWarehouse.reduce((sum, row) => sum + row.availableQuantity, 0),
      byWarehouse,
    };
  }

  async getItem(id: string): Promise<InventoryItem> {
    const item = await this.items.findById(id);
    if (!item) throw new NotFoundException('Inventory item not found');
    return item;
  }

  listByWarehouse(
    warehouseId: WarehouseId,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: InventoryItem[]; nextCursor: string | null }> {
    return this.items.listByWarehouse(warehouseId, pagination);
  }

  /** Store-level availability: which `STORE`/`DARK_STORE` warehouses
   * currently have this SKU in stock — the storefront
   * `GET /catalog/products/:slug/stores` seam. */
  async getStoreAvailability(
    skuId: ProductSkuId,
  ): Promise<{ warehouseId: WarehouseId; availableQuantity: number }[]> {
    const byWarehouse = await this.items.listBySku(skuId);
    const results: { warehouseId: WarehouseId; availableQuantity: number }[] = [];
    for (const row of byWarehouse) {
      if (row.availableQuantity <= 0) continue;
      const warehouse = await this.warehouses.findById(row.warehouseId);
      if (
        warehouse &&
        (warehouse.type === 'STORE' || warehouse.type === 'DARK_STORE') &&
        warehouse.isUsable
      ) {
        results.push({ warehouseId: row.warehouseId, availableQuantity: row.availableQuantity });
      }
    }
    return results;
  }

  async lookupByBarcode(barcode: string): Promise<SkuLookupResult> {
    const result = await this.skuLookup.findByBarcode(barcode);
    if (!result) throw new NotFoundException('No SKU found for this barcode');
    return result;
  }

  async lookupBySkuCode(skuCode: string): Promise<SkuLookupResult> {
    const result = await this.skuLookup.findBySkuCode(skuCode);
    if (!result) throw new NotFoundException('No SKU found for this SKU code');
    return result;
  }

  /** `GET /catalog/products/:slug/availability` — a product can have
   * several SKUs (one per variant); this reports per-SKU and total
   * availability across all of them, resolved purely by database read. */
  async getProductAvailability(productSlug: string): Promise<SkuAvailability[]> {
    const skus = await this.skuLookup.findByProductSlug(productSlug);
    if (skus.length === 0) throw new NotFoundException('Product not found');
    return Promise.all(skus.map((sku) => this.getAvailability(sku.id)));
  }

  /** `GET /catalog/products/:slug/stores` — every store currently holding
   * any SKU of this product. */
  async getProductStoreAvailability(
    productSlug: string,
  ): Promise<{ warehouseId: WarehouseId; availableQuantity: number }[]> {
    const skus = await this.skuLookup.findByProductSlug(productSlug);
    if (skus.length === 0) throw new NotFoundException('Product not found');
    const byWarehouse = new Map<WarehouseId, number>();
    for (const sku of skus) {
      for (const row of await this.getStoreAvailability(sku.id)) {
        byWarehouse.set(
          row.warehouseId,
          (byWarehouse.get(row.warehouseId) ?? 0) + row.availableQuantity,
        );
      }
    }
    return [...byWarehouse.entries()].map(([warehouseId, availableQuantity]) => ({
      warehouseId,
      availableQuantity,
    }));
  }
}
