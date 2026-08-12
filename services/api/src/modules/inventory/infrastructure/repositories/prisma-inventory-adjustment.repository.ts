import { randomUUID } from 'node:crypto';

import { prisma, type InventoryAdjustment as PrismaInventoryAdjustment } from '@iecp/database';
import type { InventoryAdjustmentType, ProductSkuId, WarehouseId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { InventoryAdjustment } from '../../domain/entities/inventory-adjustment.entity';
import type { InventoryAdjustmentRepositoryPort } from '../../domain/ports/inventory-adjustment.repository.port';
import { AdjustmentValidator } from '../../domain/services/adjustment-validator';
import { mutateInventoryItem } from '../inventory-item-mutator';
import { decodeCursor, encodeCursor, splitPage } from '../pagination.util';

@Injectable()
export class PrismaInventoryAdjustmentRepository implements InventoryAdjustmentRepositoryPort {
  async findById(id: string): Promise<InventoryAdjustment | null> {
    const row = await prisma.inventoryAdjustment.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async listByWarehouse(
    warehouseId: WarehouseId,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: InventoryAdjustment[]; nextCursor: string | null }> {
    const cursorClause = pagination.cursor ? decodeCursor(pagination.cursor) : null;
    const where = { warehouseId };

    const rows = await prisma.inventoryAdjustment.findMany({
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
      take: pagination.limit + 1,
    });
    const { page, hasMore } = splitPage(rows, pagination.limit);
    const last = page.at(-1);
    return {
      items: page.map(toDomain),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt.toISOString(), last.id) : null,
    };
  }

  async create(props: {
    warehouseId: WarehouseId;
    locationId: string;
    productSkuId: ProductSkuId;
    adjustmentType: InventoryAdjustmentType;
    quantity: number;
    reason: string;
    approvedBy?: string | null;
    createdBy: string;
    correlationId: string;
  }): Promise<InventoryAdjustment> {
    return prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.upsert({
        where: {
          productSkuId_warehouseId_locationId: {
            productSkuId: props.productSkuId,
            warehouseId: props.warehouseId,
            locationId: props.locationId,
          },
        },
        update: {},
        create: {
          id: randomUUID(),
          productSkuId: props.productSkuId,
          warehouseId: props.warehouseId,
          locationId: props.locationId,
        },
      });

      AdjustmentValidator.assertValid(item, props.adjustmentType, props.quantity, props.reason);

      const signedQuantity = props.adjustmentType === 'POSITIVE' ? props.quantity : -props.quantity;
      const adjustment = await tx.inventoryAdjustment.create({
        data: {
          id: randomUUID(),
          warehouseId: props.warehouseId,
          locationId: props.locationId,
          productSkuId: props.productSkuId,
          adjustmentType: props.adjustmentType,
          quantity: props.quantity,
          reason: props.reason,
          approvedBy: props.approvedBy ?? null,
          createdBy: props.createdBy,
        },
      });

      await mutateInventoryItem(tx, item.id, { onHand: signedQuantity }, 'ADJUSTMENT', {
        quantity: props.quantity,
        referenceType: 'INVENTORY_ADJUSTMENT',
        referenceId: adjustment.id,
        reason: props.reason,
        actorUserId: props.createdBy,
        correlationId: props.correlationId,
      });

      return toDomain(adjustment);
    });
  }
}

function toDomain(row: PrismaInventoryAdjustment): InventoryAdjustment {
  return InventoryAdjustment.create({
    id: row.id,
    warehouseId: row.warehouseId,
    locationId: row.locationId,
    productSkuId: row.productSkuId,
    adjustmentType: row.adjustmentType,
    quantity: row.quantity,
    reason: row.reason,
    approvedBy: row.approvedBy,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  });
}
