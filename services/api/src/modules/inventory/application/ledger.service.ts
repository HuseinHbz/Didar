import type { ProductSkuId, WarehouseId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import type { InventoryLedgerEntry } from '../domain/entities/inventory-ledger-entry.entity';
import {
  INVENTORY_LEDGER_REPOSITORY,
  type InventoryLedgerRepositoryPort,
} from '../domain/ports/inventory-ledger.repository.port';

/** Read-only — every ledger row is written by one of the other services'
 * composite operations. Paginated everywhere (the brief's own "do not
 * load full ledger tables into memory"). */
@Injectable()
export class LedgerService {
  constructor(
    @Inject(INVENTORY_LEDGER_REPOSITORY) private readonly ledger: InventoryLedgerRepositoryPort,
  ) {}

  listBySku(
    skuId: ProductSkuId,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: InventoryLedgerEntry[]; nextCursor: string | null }> {
    return this.ledger.listBySku(skuId, pagination);
  }

  listByWarehouse(
    warehouseId: WarehouseId,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: InventoryLedgerEntry[]; nextCursor: string | null }> {
    return this.ledger.listByWarehouse(warehouseId, pagination);
  }

  listByReference(referenceType: string, referenceId: string): Promise<InventoryLedgerEntry[]> {
    return this.ledger.listByReference(referenceType, referenceId);
  }
}
