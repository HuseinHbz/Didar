import type { ProductSkuId, WarehouseId } from '@iecp/types';

import type { InventoryLedgerEntry } from '../entities/inventory-ledger-entry.entity';

export const INVENTORY_LEDGER_REPOSITORY = Symbol('INVENTORY_LEDGER_REPOSITORY');

/** Read-only — every ledger row is written as part of one of the other
 * ports' composite transactional operations (reserve, adjust, transfer
 * dispatch/receive, ...), never directly. Append-only, so there is no
 * update/delete method here at all. */
export interface InventoryLedgerRepositoryPort {
  listBySku(
    skuId: ProductSkuId,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: InventoryLedgerEntry[]; nextCursor: string | null }>;
  listByReference(referenceType: string, referenceId: string): Promise<InventoryLedgerEntry[]>;
  listByWarehouse(
    warehouseId: WarehouseId,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: InventoryLedgerEntry[]; nextCursor: string | null }>;
}
