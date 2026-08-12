import type { LocationType, WarehouseId, WarehouseLocationId } from '@iecp/types';

import type { WarehouseLocation } from '../entities/warehouse-location.entity';

export const WAREHOUSE_LOCATION_REPOSITORY = Symbol('WAREHOUSE_LOCATION_REPOSITORY');

export interface WarehouseLocationRepositoryPort {
  findById(id: WarehouseLocationId): Promise<WarehouseLocation | null>;
  findByWarehouseAndCode(warehouseId: WarehouseId, code: string): Promise<WarehouseLocation | null>;
  listByWarehouse(warehouseId: WarehouseId): Promise<WarehouseLocation[]>;
  create(props: {
    warehouseId: string;
    code: string;
    name: string;
    type?: LocationType;
    active?: boolean;
  }): Promise<WarehouseLocation>;
  update(
    id: WarehouseLocationId,
    props: Partial<{ name: string; type: LocationType; active: boolean }>,
  ): Promise<WarehouseLocation>;
}
