import {
  asInventoryItemId,
  asInventoryReservationId,
  asProductSkuId,
  asWarehouseId,
  asWarehouseLocationId,
  type InventoryItemId,
  type InventoryReservationId,
  type InventoryReservationStatus,
  type ProductSkuId,
  type WarehouseId,
  type WarehouseLocationId,
} from '@iecp/types';

/** Transactional, row-lock-serialized, idempotency-key-protected — see
 * ADR-006 decisions 4-5. `sourceType`/`sourceId` are deliberately
 * polymorphic (cart, order, POS sale, home-try-on — none of which this
 * phase implements). */
export class InventoryReservation {
  private constructor(
    public readonly id: InventoryReservationId,
    public readonly productSkuId: ProductSkuId,
    public readonly warehouseId: WarehouseId,
    public readonly locationId: WarehouseLocationId,
    public readonly inventoryItemId: InventoryItemId,
    public readonly quantity: number,
    public readonly status: InventoryReservationStatus,
    public readonly sourceType: string,
    public readonly sourceId: string,
    public readonly idempotencyKey: string,
    public readonly expiresAt: Date | null,
    public readonly releasedAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    productSkuId: string;
    warehouseId: string;
    locationId: string;
    inventoryItemId: string;
    quantity: number;
    status?: InventoryReservationStatus;
    sourceType: string;
    sourceId: string;
    idempotencyKey: string;
    expiresAt?: Date | null;
    releasedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): InventoryReservation {
    return new InventoryReservation(
      asInventoryReservationId(props.id),
      asProductSkuId(props.productSkuId),
      asWarehouseId(props.warehouseId),
      asWarehouseLocationId(props.locationId),
      asInventoryItemId(props.inventoryItemId),
      props.quantity,
      props.status ?? 'ACTIVE',
      props.sourceType,
      props.sourceId,
      props.idempotencyKey,
      props.expiresAt ?? null,
      props.releasedAt ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }

  get isActive(): boolean {
    return this.status === 'ACTIVE';
  }

  get isExpired(): boolean {
    return (
      this.status === 'ACTIVE' && this.expiresAt !== null && this.expiresAt.getTime() < Date.now()
    );
  }
}
