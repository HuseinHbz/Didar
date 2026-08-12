import type { LocationType, WarehouseId, WarehouseLocationId } from '@iecp/types';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { WarehouseLocation } from '../domain/entities/warehouse-location.entity';
import {
  WAREHOUSE_LOCATION_REPOSITORY,
  type WarehouseLocationRepositoryPort,
} from '../domain/ports/warehouse-location.repository.port';
import {
  WAREHOUSE_REPOSITORY,
  type WarehouseRepositoryPort,
} from '../domain/ports/warehouse.repository.port';

@Injectable()
export class LocationsService {
  constructor(
    @Inject(WAREHOUSE_LOCATION_REPOSITORY)
    private readonly locations: WarehouseLocationRepositoryPort,
    @Inject(WAREHOUSE_REPOSITORY) private readonly warehouses: WarehouseRepositoryPort,
  ) {}

  async get(id: WarehouseLocationId): Promise<WarehouseLocation> {
    const location = await this.locations.findById(id);
    if (!location) throw new NotFoundException('Warehouse location not found');
    return location;
  }

  listByWarehouse(warehouseId: WarehouseId): Promise<WarehouseLocation[]> {
    return this.locations.listByWarehouse(warehouseId);
  }

  async create(input: {
    warehouseId: string;
    code: string;
    name: string;
    type?: LocationType;
    active?: boolean;
  }): Promise<WarehouseLocation> {
    const warehouse = await this.warehouses.findById(input.warehouseId as WarehouseId);
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const existing = await this.locations.findByWarehouseAndCode(warehouse.id, input.code);
    if (existing)
      throw new ConflictException(`Location code "${input.code}" already exists in this warehouse`);

    return this.locations.create(input);
  }

  async update(
    id: WarehouseLocationId,
    input: Partial<{ name: string; type: LocationType; active: boolean }>,
  ): Promise<WarehouseLocation> {
    await this.get(id);
    return this.locations.update(id, input);
  }
}
