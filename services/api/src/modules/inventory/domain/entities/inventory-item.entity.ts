import {
  asInventoryItemId,
  asProductSkuId,
  asWarehouseId,
  asWarehouseLocationId,
  type InventoryItemId,
  type ProductSkuId,
  type WarehouseId,
  type WarehouseLocationId,
} from '@iecp/types';

/** blueprint §23 — quantity buckets are a maintained cache, never the
 * authority; `InventoryLedgerEntry` is the source of truth for *why* each
 * one is what it is (ADR-006 decision 2). `version` supports optimistic
 * callers on top of the row lock every mutation already takes. */
export class InventoryItem {
  private constructor(
    public readonly id: InventoryItemId,
    public readonly productSkuId: ProductSkuId,
    public readonly warehouseId: WarehouseId,
    public readonly locationId: WarehouseLocationId,
    public readonly onHandQuantity: number,
    public readonly reservedQuantity: number,
    public readonly availableQuantity: number,
    public readonly inTransitQuantity: number,
    public readonly damagedQuantity: number,
    public readonly quarantinedQuantity: number,
    public readonly blockedQuantity: number,
    public readonly version: number,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    productSkuId: string;
    warehouseId: string;
    locationId: string;
    onHandQuantity?: number;
    reservedQuantity?: number;
    availableQuantity?: number;
    inTransitQuantity?: number;
    damagedQuantity?: number;
    quarantinedQuantity?: number;
    blockedQuantity?: number;
    version?: number;
    createdAt: Date;
    updatedAt: Date;
  }): InventoryItem {
    return new InventoryItem(
      asInventoryItemId(props.id),
      asProductSkuId(props.productSkuId),
      asWarehouseId(props.warehouseId),
      asWarehouseLocationId(props.locationId),
      props.onHandQuantity ?? 0,
      props.reservedQuantity ?? 0,
      props.availableQuantity ?? 0,
      props.inTransitQuantity ?? 0,
      props.damagedQuantity ?? 0,
      props.quarantinedQuantity ?? 0,
      props.blockedQuantity ?? 0,
      props.version ?? 0,
      props.createdAt,
      props.updatedAt,
    );
  }
}
