import type { WarehouseId, WarehouseStatus, WarehouseType } from '@iecp/types';

import type { Warehouse } from '../entities/warehouse.entity';

export const WAREHOUSE_REPOSITORY = Symbol('WAREHOUSE_REPOSITORY');

export interface ListWarehousesFilter {
  status?: WarehouseStatus;
  type?: WarehouseType;
  cursor?: string;
  limit: number;
}

export interface WarehouseRepositoryPort {
  findById(id: WarehouseId): Promise<Warehouse | null>;
  findByCode(code: string): Promise<Warehouse | null>;
  list(filter: ListWarehousesFilter): Promise<{ items: Warehouse[]; nextCursor: string | null }>;
  create(props: {
    code: string;
    name: string;
    type?: WarehouseType;
    status?: WarehouseStatus;
    address?: string | null;
    timezone?: string;
    capacity?: number | null;
  }): Promise<Warehouse>;
  update(
    id: WarehouseId,
    props: Partial<{
      name: string;
      type: WarehouseType;
      status: WarehouseStatus;
      address: string | null;
      timezone: string;
      capacity: number | null;
    }>,
  ): Promise<Warehouse>;
}
