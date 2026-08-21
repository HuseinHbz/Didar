import { randomUUID } from 'node:crypto';

import {
  Prisma,
  type InventoryItem as PrismaInventoryItem,
  type InventoryLedger as PrismaInventoryLedger,
  type PrismaClient,
} from '@iecp/database';
import type { InventoryMovementType } from '@iecp/types';

import { AvailableQuantityCalculator } from '../domain/services/available-quantity-calculator';

/**
 * The one place every quantity-mutating operation in this module actually
 * touches `InventoryItem` — reserve/release/convert, receive, adjust,
 * transfer dispatch/receive, count reconciliation all funnel through this
 * function. Centralizing it means the row-lock + validate + ledger-write
 * sequence (ADR-006 decisions 2-4) is implemented exactly once, not
 * re-derived per operation with room for one of them to forget a step.
 *
 * Must be called with a transaction client (`tx`, from `prisma.$transaction`)
 * — `SELECT ... FOR UPDATE` only serializes concurrent callers when it runs
 * inside the same transaction as the write that follows it. Passing the
 * top-level `prisma` client here would silently defeat the whole
 * concurrency guarantee, so this function's signature requires a tx client.
 */
type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface InventoryItemDelta {
  onHand?: number;
  reserved?: number;
  inTransit?: number;
  damaged?: number;
  quarantined?: number;
  blocked?: number;
}

interface LockedRow {
  id: string;
  productSkuId: string;
  warehouseId: string;
  locationId: string;
  onHandQuantity: number;
  reservedQuantity: number;
  inTransitQuantity: number;
  damagedQuantity: number;
  quarantinedQuantity: number;
  blockedQuantity: number;
}

export interface MutationResult {
  item: PrismaInventoryItem;
  ledgerEntry: PrismaInventoryLedger;
}

/** Row-locks the target `InventoryItem`, applies `delta` to its quantity
 * buckets, asserts the never-negative invariant on the projected state,
 * writes the row and one `InventoryLedger` entry, and returns both. Throws
 * `InsufficientStockError` (via `AvailableQuantityCalculator`) before any
 * write if the projected state would be invalid. */
export async function mutateInventoryItem(
  tx: TxClient,
  inventoryItemId: string,
  delta: InventoryItemDelta,
  movementType: InventoryMovementType,
  meta: {
    /** The ledger row's own `quantity` column — the magnitude of this
     * movement's primary effect (e.g. the reserved quantity for a
     * RESERVATION entry, the received quantity for a TRANSFER_IN entry).
     * Passed explicitly rather than inferred from `delta`, since a single
     * mutation can touch more than one bucket (e.g. QUARANTINE moves units
     * from on-hand into quarantined at once). */
    quantity: number;
    referenceType?: string | null;
    referenceId?: string | null;
    reason?: string | null;
    actorUserId?: string | null;
    correlationId: string;
    /** ADR-013 decision 6 — a deterministic, caller-supplied key
     * written onto the new `InventoryLedger` row's own `@unique`
     * `idempotencyKey` column. Optional: every pre-Phase-013 call site
     * omits it, unaffected. The one caller that supplies it
     * (`AdjustmentService.receiveReturnedStock()`) relies on the
     * caller catching this insert's `P2002` and re-reading the
     * existing row rather than mutating a second time — see
     * `PrismaInventoryItemRepository.receiveStock()`'s own doc
     * comment. */
    idempotencyKey?: string | null;
  },
): Promise<MutationResult> {
  const rows = await tx.$queryRaw<LockedRow[]>(
    Prisma.sql`SELECT id, product_sku_id AS "productSkuId", warehouse_id AS "warehouseId",
      location_id AS "locationId", on_hand_quantity AS "onHandQuantity",
      reserved_quantity AS "reservedQuantity",
      in_transit_quantity AS "inTransitQuantity", damaged_quantity AS "damagedQuantity",
      quarantined_quantity AS "quarantinedQuantity", blocked_quantity AS "blockedQuantity"
    FROM inventory.inventory_items WHERE id = ${inventoryItemId}::uuid FOR UPDATE`,
  );
  const current = rows[0];
  if (!current) {
    throw new Error(`InventoryItem ${inventoryItemId} not found`);
  }

  const beforeOnHand = current.onHandQuantity;
  const beforeReserved = current.reservedQuantity;

  const projected = {
    onHandQuantity: current.onHandQuantity + (delta.onHand ?? 0),
    reservedQuantity: current.reservedQuantity + (delta.reserved ?? 0),
    inTransitQuantity: current.inTransitQuantity + (delta.inTransit ?? 0),
    damagedQuantity: current.damagedQuantity + (delta.damaged ?? 0),
    quarantinedQuantity: current.quarantinedQuantity + (delta.quarantined ?? 0),
    blockedQuantity: current.blockedQuantity + (delta.blocked ?? 0),
  };
  const availableQuantity = AvailableQuantityCalculator.assertNonNegative(projected);

  const item = await tx.inventoryItem.update({
    where: { id: inventoryItemId },
    data: {
      onHandQuantity: projected.onHandQuantity,
      reservedQuantity: projected.reservedQuantity,
      inTransitQuantity: projected.inTransitQuantity,
      damagedQuantity: projected.damagedQuantity,
      quarantinedQuantity: projected.quarantinedQuantity,
      blockedQuantity: projected.blockedQuantity,
      availableQuantity,
      version: { increment: 1 },
    },
  });

  const ledgerEntry = await tx.inventoryLedger.create({
    data: {
      id: randomUUID(),
      inventoryItemId: current.id,
      productSkuId: current.productSkuId,
      warehouseId: current.warehouseId,
      locationId: current.locationId,
      movementType,
      quantity: meta.quantity,
      beforeOnHand,
      afterOnHand: projected.onHandQuantity,
      beforeReserved,
      afterReserved: projected.reservedQuantity,
      referenceType: meta.referenceType ?? null,
      referenceId: meta.referenceId ?? null,
      idempotencyKey: meta.idempotencyKey ?? null,
      reason: meta.reason ?? null,
      actorUserId: meta.actorUserId ?? null,
      correlationId: meta.correlationId,
    },
  });

  return { item, ledgerEntry };
}
