import type { ProductSkuId, WarehouseId, WarehouseLocationId } from '@iecp/types';

import type { InventoryItem } from '../entities/inventory-item.entity';
import type { InventoryLedgerEntry } from '../entities/inventory-ledger-entry.entity';

export const INVENTORY_ITEM_REPOSITORY = Symbol('INVENTORY_ITEM_REPOSITORY');

export interface StockBySkuRow {
  warehouseId: WarehouseId;
  locationId: WarehouseLocationId;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  inTransitQuantity: number;
  damagedQuantity: number;
  quarantinedQuantity: number;
  blockedQuantity: number;
}

export interface InventoryItemRepositoryPort {
  findById(id: string): Promise<InventoryItem | null>;
  findBySkuWarehouseLocation(
    skuId: ProductSkuId,
    warehouseId: WarehouseId,
    locationId: WarehouseLocationId,
  ): Promise<InventoryItem | null>;
  /** Every location's stock row for one SKU, across every warehouse —
   * the shape both `GET /internal/inventory/availability/:skuId` and the
   * allocation engine read from. */
  listBySku(skuId: ProductSkuId): Promise<StockBySkuRow[]>;
  listByWarehouse(
    warehouseId: WarehouseId,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: InventoryItem[]; nextCursor: string | null }>;
  /** Find-or-create a zeroed row for this SKU+warehouse+location — a
   * warehouse must have a location before it can hold stock (ADR-006
   * decision 1), but an `InventoryItem` row itself is created lazily on
   * first stock movement, not when the SKU is authored in the catalog. */
  ensureItem(
    skuId: ProductSkuId,
    warehouseId: WarehouseId,
    locationId: WarehouseLocationId,
  ): Promise<InventoryItem>;
  /**
   * Receives new stock (a purchase, or the readiness seam for a future
   * Procurement phase's goods receipt — ADR-006 decision 9). Transactional:
   * row-locks the target item, increments `onHandQuantity`/
   * `availableQuantity`, writes one `PURCHASE_RECEIPT`/`RETURN_RECEIPT`
   * ledger entry in the same transaction.
   *
   * `idempotencyKey`, when supplied (ADR-013 decision 6), is
   * P2002-catch-and-reread safe — a retried "receive this stock" call
   * reusing the same key resolves to the item's *current* state and the
   * *original* ledger entry rather than mutating a second time. Every
   * pre-Phase-013 call site omits it and keeps its prior at-most-once-
   * per-call-site behavior unchanged.
   */
  receiveStock(props: {
    productSkuId: ProductSkuId;
    warehouseId: WarehouseId;
    locationId: WarehouseLocationId;
    quantity: number;
    movementType?: 'PURCHASE_RECEIPT' | 'RETURN_RECEIPT';
    referenceType?: string | null;
    referenceId?: string | null;
    reason?: string | null;
    actorUserId?: string | null;
    correlationId: string;
    idempotencyKey?: string | null;
  }): Promise<{ item: InventoryItem; ledgerEntry: InventoryLedgerEntry }>;
}
