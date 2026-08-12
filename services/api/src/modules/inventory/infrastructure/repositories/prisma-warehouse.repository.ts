import { prisma, type Warehouse as PrismaWarehouse } from '@iecp/database';
import type { WarehouseId, WarehouseStatus, WarehouseType } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { Warehouse } from '../../domain/entities/warehouse.entity';
import type {
  ListWarehousesFilter,
  WarehouseRepositoryPort,
} from '../../domain/ports/warehouse.repository.port';
import { decodeCursor, encodeCursor, splitPage } from '../pagination.util';

@Injectable()
export class PrismaWarehouseRepository implements WarehouseRepositoryPort {
  async findById(id: WarehouseId): Promise<Warehouse | null> {
    const row = await prisma.warehouse.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByCode(code: string): Promise<Warehouse | null> {
    const row = await prisma.warehouse.findUnique({ where: { code } });
    return row ? toDomain(row) : null;
  }

  async list(
    filter: ListWarehousesFilter,
  ): Promise<{ items: Warehouse[]; nextCursor: string | null }> {
    const cursorClause = filter.cursor ? decodeCursor(filter.cursor) : null;
    const where = {
      ...(filter.status !== undefined && { status: filter.status }),
      ...(filter.type !== undefined && { type: filter.type }),
      deletedAt: null,
    };

    const rows = await prisma.warehouse.findMany({
      where: cursorClause
        ? {
            ...where,
            OR: [
              { createdAt: { lt: new Date(cursorClause.sortValue) } },
              { createdAt: new Date(cursorClause.sortValue), id: { lt: cursorClause.id } },
            ],
          }
        : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
    });

    const { page, hasMore } = splitPage(rows, filter.limit);
    const last = page.at(-1);
    return {
      items: page.map(toDomain),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt.toISOString(), last.id) : null,
    };
  }

  async create(props: {
    code: string;
    name: string;
    type?: WarehouseType;
    status?: WarehouseStatus;
    address?: string | null;
    timezone?: string;
    capacity?: number | null;
  }): Promise<Warehouse> {
    const row = await prisma.warehouse.create({
      data: {
        code: props.code,
        name: props.name,
        ...(props.type !== undefined && { type: props.type }),
        ...(props.status !== undefined && { status: props.status }),
        address: props.address ?? null,
        timezone: props.timezone ?? 'Asia/Tehran',
        capacity: props.capacity ?? null,
      },
    });
    return toDomain(row);
  }

  async update(
    id: WarehouseId,
    props: Partial<{
      name: string;
      type: WarehouseType;
      status: WarehouseStatus;
      address: string | null;
      timezone: string;
      capacity: number | null;
    }>,
  ): Promise<Warehouse> {
    const row = await prisma.warehouse.update({
      where: { id },
      data: {
        ...(props.name !== undefined && { name: props.name }),
        ...(props.type !== undefined && { type: props.type }),
        ...(props.status !== undefined && { status: props.status }),
        ...(props.address !== undefined && { address: props.address }),
        ...(props.timezone !== undefined && { timezone: props.timezone }),
        ...(props.capacity !== undefined && { capacity: props.capacity }),
      },
    });
    return toDomain(row);
  }
}

function toDomain(row: PrismaWarehouse): Warehouse {
  return Warehouse.create({
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    status: row.status,
    address: row.address,
    timezone: row.timezone,
    capacity: row.capacity,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}
