import type { WarehouseId, WarehouseStatus, WarehouseType } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { Warehouse } from '../domain/entities/warehouse.entity';
import {
  WAREHOUSE_LOCATION_REPOSITORY,
  type WarehouseLocationRepositoryPort,
} from '../domain/ports/warehouse-location.repository.port';
import {
  WAREHOUSE_REPOSITORY,
  type ListWarehousesFilter,
  type WarehouseRepositoryPort,
} from '../domain/ports/warehouse.repository.port';

/**
 * Warehouse admin CRUD. Every new warehouse gets a default `STORAGE`
 * location created in the same call — a warehouse with zero locations
 * can't hold stock (ADR-006 decision 1), and there's no separate
 * "add your first location" step an admin has to remember.
 */
@Injectable()
export class WarehousesService {
  constructor(
    @Inject(WAREHOUSE_REPOSITORY) private readonly warehouses: WarehouseRepositoryPort,
    @Inject(WAREHOUSE_LOCATION_REPOSITORY)
    private readonly locations: WarehouseLocationRepositoryPort,
  ) {}

  async get(id: WarehouseId): Promise<Warehouse> {
    const warehouse = await this.warehouses.findById(id);
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    return warehouse;
  }

  list(filter: ListWarehousesFilter): Promise<{ items: Warehouse[]; nextCursor: string | null }> {
    return this.warehouses.list(filter);
  }

  async create(input: {
    code: string;
    name: string;
    type?: WarehouseType;
    status?: WarehouseStatus;
    address?: string | null;
    timezone?: string;
    capacity?: number | null;
  }): Promise<Warehouse> {
    const warehouse = await this.warehouses.create(input);
    await this.locations.create({
      warehouseId: warehouse.id,
      code: 'MAIN',
      name: 'Main Storage',
      type: 'STORAGE',
    });
    return warehouse;
  }

  async update(
    id: WarehouseId,
    input: Partial<{
      name: string;
      type: WarehouseType;
      status: WarehouseStatus;
      address: string | null;
      timezone: string;
      capacity: number | null;
    }>,
  ): Promise<Warehouse> {
    await this.get(id);
    return this.warehouses.update(id, input);
  }
}
