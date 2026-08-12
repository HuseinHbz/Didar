import { prisma, type WarehouseLocation as PrismaWarehouseLocation } from '@iecp/database';
import type { LocationType, WarehouseId, WarehouseLocationId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { WarehouseLocation } from '../../domain/entities/warehouse-location.entity';
import type { WarehouseLocationRepositoryPort } from '../../domain/ports/warehouse-location.repository.port';

@Injectable()
export class PrismaWarehouseLocationRepository implements WarehouseLocationRepositoryPort {
  async findById(id: WarehouseLocationId): Promise<WarehouseLocation | null> {
    const row = await prisma.warehouseLocation.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByWarehouseAndCode(
    warehouseId: WarehouseId,
    code: string,
  ): Promise<WarehouseLocation | null> {
    const row = await prisma.warehouseLocation.findUnique({
      where: { warehouseId_code: { warehouseId, code } },
    });
    return row ? toDomain(row) : null;
  }

  async listByWarehouse(warehouseId: WarehouseId): Promise<WarehouseLocation[]> {
    const rows = await prisma.warehouseLocation.findMany({
      where: { warehouseId },
      orderBy: { code: 'asc' },
    });
    return rows.map(toDomain);
  }

  async create(props: {
    warehouseId: string;
    code: string;
    name: string;
    type?: LocationType;
    active?: boolean;
  }): Promise<WarehouseLocation> {
    const row = await prisma.warehouseLocation.create({
      data: {
        warehouseId: props.warehouseId,
        code: props.code,
        name: props.name,
        ...(props.type !== undefined && { type: props.type }),
        ...(props.active !== undefined && { active: props.active }),
      },
    });
    return toDomain(row);
  }

  async update(
    id: WarehouseLocationId,
    props: Partial<{ name: string; type: LocationType; active: boolean }>,
  ): Promise<WarehouseLocation> {
    const row = await prisma.warehouseLocation.update({
      where: { id },
      data: {
        ...(props.name !== undefined && { name: props.name }),
        ...(props.type !== undefined && { type: props.type }),
        ...(props.active !== undefined && { active: props.active }),
      },
    });
    return toDomain(row);
  }
}

function toDomain(row: PrismaWarehouseLocation): WarehouseLocation {
  return WarehouseLocation.create({
    id: row.id,
    warehouseId: row.warehouseId,
    code: row.code,
    name: row.name,
    type: row.type,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
