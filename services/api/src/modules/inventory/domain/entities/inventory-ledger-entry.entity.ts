import {
  asInventoryItemId,
  asInventoryLedgerId,
  asProductSkuId,
  asUserId,
  asWarehouseId,
  asWarehouseLocationId,
  type InventoryItemId,
  type InventoryLedgerId,
  type InventoryMovementType,
  type ProductSkuId,
  type UserId,
  type WarehouseId,
  type WarehouseLocationId,
} from '@iecp/types';

/** blueprint §24/§27 — one append-only row per quantity mutation. Never
 * updated, never deleted (ADR-006 decision 2). `referenceType`/
 * `referenceId` are deliberately untyped/polymorphic — the procurement/
 * returns readiness seam (ADR-006 decision 9). */
export class InventoryLedgerEntry {
  private constructor(
    public readonly id: InventoryLedgerId,
    public readonly inventoryItemId: InventoryItemId,
    public readonly productSkuId: ProductSkuId,
    public readonly warehouseId: WarehouseId,
    public readonly locationId: WarehouseLocationId,
    public readonly movementType: InventoryMovementType,
    public readonly quantity: number,
    public readonly beforeOnHand: number,
    public readonly afterOnHand: number,
    public readonly beforeReserved: number,
    public readonly afterReserved: number,
    public readonly referenceType: string | null,
    public readonly referenceId: string | null,
    public readonly reason: string | null,
    public readonly actorUserId: UserId | null,
    public readonly correlationId: string,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    inventoryItemId: string;
    productSkuId: string;
    warehouseId: string;
    locationId: string;
    movementType: InventoryMovementType;
    quantity: number;
    beforeOnHand: number;
    afterOnHand: number;
    beforeReserved: number;
    afterReserved: number;
    referenceType?: string | null;
    referenceId?: string | null;
    reason?: string | null;
    actorUserId?: string | null;
    correlationId: string;
    createdAt: Date;
  }): InventoryLedgerEntry {
    return new InventoryLedgerEntry(
      asInventoryLedgerId(props.id),
      asInventoryItemId(props.inventoryItemId),
      asProductSkuId(props.productSkuId),
      asWarehouseId(props.warehouseId),
      asWarehouseLocationId(props.locationId),
      props.movementType,
      props.quantity,
      props.beforeOnHand,
      props.afterOnHand,
      props.beforeReserved,
      props.afterReserved,
      props.referenceType ?? null,
      props.referenceId ?? null,
      props.reason ?? null,
      props.actorUserId ? asUserId(props.actorUserId) : null,
      props.correlationId,
      props.createdAt,
    );
  }
}
