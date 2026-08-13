import { prisma, type ShippingMethod as PrismaShippingMethod } from '@iecp/database';
import { Injectable } from '@nestjs/common';

import {
  ShippingMethod,
  type ShippingZoneMatch,
} from '../../domain/entities/shipping-method.entity';
import type { ShippingMethodRepositoryPort } from '../../domain/ports/shipping-method.repository.port';

function toDomain(row: PrismaShippingMethod): ShippingMethod {
  return ShippingMethod.create({
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    baseCost: row.baseCost,
    freeAboveAmount: row.freeAboveAmount,
    warehouseId: row.warehouseId,
    zoneMatch: (row.zoneMatch as ShippingZoneMatch | null) ?? null,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

@Injectable()
export class PrismaShippingMethodRepository implements ShippingMethodRepositoryPort {
  async findById(id: string): Promise<ShippingMethod | null> {
    const row = await prisma.shippingMethod.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByCode(code: string): Promise<ShippingMethod | null> {
    const row = await prisma.shippingMethod.findUnique({ where: { code } });
    return row ? toDomain(row) : null;
  }

  async listActive(): Promise<ShippingMethod[]> {
    const rows = await prisma.shippingMethod.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(toDomain);
  }
}
