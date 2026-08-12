import type { InventoryLedger as PrismaInventoryLedger } from '@iecp/database';

import { InventoryItem } from '../domain/entities/inventory-item.entity';
import { InventoryLedgerEntry } from '../domain/entities/inventory-ledger-entry.entity';

/** Shared row->domain mapper — every repository that writes a ledger row
 * inside its own composite transaction (reservation, adjustment, transfer,
 * stock count, receive) needs to turn the raw Prisma row it just created
 * back into a domain `InventoryLedgerEntry`. */
export function ledgerEntryToDomain(row: PrismaInventoryLedger): InventoryLedgerEntry {
  return InventoryLedgerEntry.create({
    id: row.id,
    inventoryItemId: row.inventoryItemId,
    productSkuId: row.productSkuId,
    warehouseId: row.warehouseId,
    locationId: row.locationId,
    movementType: row.movementType,
    quantity: row.quantity,
    beforeOnHand: row.beforeOnHand,
    afterOnHand: row.afterOnHand,
    beforeReserved: row.beforeReserved,
    afterReserved: row.afterReserved,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    reason: row.reason,
    actorUserId: row.actorUserId,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
  });
}

/** Same mapper for `InventoryItem` — reused by every repository whose
 * composite operation returns the freshly-mutated item alongside the
 * ledger entry it wrote. `updatedAt` is stamped fresh (the caller just
 * wrote this row inside the same transaction; Prisma's raw-locking read in
 * `mutateInventoryItem` doesn't re-select it). */
export function inventoryItemToDomain(row: {
  id: string;
  productSkuId: string;
  warehouseId: string;
  locationId: string;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  inTransitQuantity: number;
  damagedQuantity: number;
  quarantinedQuantity: number;
  blockedQuantity: number;
  version: number;
  createdAt: Date;
  updatedAt?: Date;
}): InventoryItem {
  return InventoryItem.create({ ...row, updatedAt: row.updatedAt ?? new Date() });
}
