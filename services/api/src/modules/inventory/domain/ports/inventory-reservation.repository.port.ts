import type { ProductSkuId, WarehouseId } from '@iecp/types';

import type { InventoryReservation } from '../entities/inventory-reservation.entity';

export const INVENTORY_RESERVATION_REPOSITORY = Symbol('INVENTORY_RESERVATION_REPOSITORY');

/**
 * Every write method here is transactional and row-lock-serialized against
 * the target `InventoryItem` (ADR-006 decisions 3-4) — this is the actual
 * overselling-proof seam, not a thin CRUD wrapper.
 */
export interface InventoryReservationRepositoryPort {
  findById(id: string): Promise<InventoryReservation | null>;
  findByIdempotencyKey(key: string): Promise<InventoryReservation | null>;
  /** Every currently-ACTIVE reservation whose `expiresAt` has already
   * passed — what the `reservation_expiration` BullMQ processor sweeps. */
  listExpirable(now: Date): Promise<InventoryReservation[]>;
  listBySource(sourceType: string, sourceId: string): Promise<InventoryReservation[]>;
  /** Idempotent on `idempotencyKey` — a retried call with the same key
   * returns the original reservation instead of double-reserving. */
  reserve(props: {
    productSkuId: ProductSkuId;
    warehouseId: WarehouseId;
    quantity: number;
    sourceType: string;
    sourceId: string;
    idempotencyKey: string;
    expiresAt?: Date | null;
    actorUserId?: string | null;
    correlationId: string;
  }): Promise<InventoryReservation>;
  release(
    id: string,
    props: { actorUserId?: string | null; correlationId: string; reason?: string | null },
  ): Promise<InventoryReservation>;
  /** Reserved -> sold: removes the quantity from both `reservedQuantity`
   * and `onHandQuantity` in the same transaction. */
  convert(
    id: string,
    props: {
      actorUserId?: string | null;
      correlationId: string;
      referenceType?: string | null;
      referenceId?: string | null;
    },
  ): Promise<InventoryReservation>;
  expire(id: string, props: { correlationId: string }): Promise<InventoryReservation>;
}
