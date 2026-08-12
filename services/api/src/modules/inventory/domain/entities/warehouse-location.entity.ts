import {
  asWarehouseId,
  asWarehouseLocationId,
  type LocationType,
  type WarehouseId,
  type WarehouseLocationId,
} from '@iecp/types';

/** A warehouse must have >=1 of these before it can hold stock —
 * ADR-006 decision 1. */
export class WarehouseLocation {
  private constructor(
    public readonly id: WarehouseLocationId,
    public readonly warehouseId: WarehouseId,
    public readonly code: string,
    public readonly name: string,
    public readonly type: LocationType,
    public readonly active: boolean,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    warehouseId: string;
    code: string;
    name: string;
    type?: LocationType;
    active?: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): WarehouseLocation {
    return new WarehouseLocation(
      asWarehouseLocationId(props.id),
      asWarehouseId(props.warehouseId),
      props.code,
      props.name,
      props.type ?? 'STORAGE',
      props.active ?? true,
      props.createdAt,
      props.updatedAt,
    );
  }
}
