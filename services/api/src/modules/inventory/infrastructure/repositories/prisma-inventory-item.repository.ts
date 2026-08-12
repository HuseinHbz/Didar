import { randomUUID } from 'node:crypto';

import { prisma, type InventoryItem as PrismaInventoryItem } from '@iecp/database';
import type { ProductSkuId, WarehouseId, WarehouseLocationId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { InventoryItem } from '../../domain/entities/inventory-item.entity';
import type { InventoryLedgerEntry } from '../../domain/entities/inventory-ledger-entry.entity';
import type {
  InventoryItemRepositoryPort,
  StockBySkuRow,
} from '../../domain/ports/inventory-item.repository.port';
import { mutateInventoryItem } from '../inventory-item-mutator';
import { inventoryItemToDomain, ledgerEntryToDomain } from '../ledger-entry.mapper';
import { decodeCursor, encodeCursor, splitPage } from '../pagination.util';

@Injectable()
export class PrismaInventoryItemRepository implements InventoryItemRepositoryPort {
  async findById(id: string): Promise<InventoryItem | null> {
    const row = await prisma.inventoryItem.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findBySkuWarehouseLocation(
    skuId: ProductSkuId,
    warehouseId: WarehouseId,
    locationId: WarehouseLocationId,
  ): Promise<InventoryItem | null> {
    const row = await prisma.inventoryItem.findUnique({
      where: {
        productSkuId_warehouseId_locationId: { productSkuId: skuId, warehouseId, locationId },
      },
    });
    return row ? toDomain(row) : null;
  }

  async listBySku(skuId: ProductSkuId): Promise<StockBySkuRow[]> {
    const rows = await prisma.inventoryItem.findMany({ where: { productSkuId: skuId } });
    return rows.map((row) => ({
      warehouseId: row.warehouseId as WarehouseId,
      locationId: row.locationId as WarehouseLocationId,
      onHandQuantity: row.onHandQuantity,
      reservedQuantity: row.reservedQuantity,
      availableQuantity: row.availableQuantity,
      inTransitQuantity: row.inTransitQuantity,
      damagedQuantity: row.damagedQuantity,
      quarantinedQuantity: row.quarantinedQuantity,
      blockedQuantity: row.blockedQuantity,
    }));
  }

  async listByWarehouse(
    warehouseId: WarehouseId,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: InventoryItem[]; nextCursor: string | null }> {
    const cursorClause = pagination.cursor ? decodeCursor(pagination.cursor) : null;
    const where = { warehouseId };

    const rows = await prisma.inventoryItem.findMany({
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

  async ensureItem(
    skuId: ProductSkuId,
    warehouseId: WarehouseId,
    locationId: WarehouseLocationId,
  ): Promise<InventoryItem> {
    const row = await prisma.inventoryItem.upsert({
      where: {
        productSkuId_warehouseId_locationId: { productSkuId: skuId, warehouseId, locationId },
      },
      update: {},
      create: { id: randomUUID(), productSkuId: skuId, warehouseId, locationId },
    });
    return toDomain(row);
  }

  async receiveStock(props: {
    productSkuId: ProductSkuId;
    warehouseId: WarehouseId;
    locationId: WarehouseLocationId;
    quantity: number;
    movementType?: 'PURCHASE_RECEIPT' | 'RETURN_RECEIPT';
    referenceType?: string | null;
    referenceId?: string | null;
    reason?: string | null;
    actorUserId?: string | null;
    correlationId: string;
  }): Promise<{ item: InventoryItem; ledgerEntry: InventoryLedgerEntry }> {
    if (props.quantity <= 0) {
      throw new Error(`receiveStock quantity must be positive, got ${props.quantity}`);
    }
    return prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryItem.upsert({
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

      const { item, ledgerEntry } = await mutateInventoryItem(
        tx,
        existing.id,
        { onHand: props.quantity },
        props.movementType ?? 'PURCHASE_RECEIPT',
        {
          quantity: props.quantity,
          referenceType: props.referenceType,
          referenceId: props.referenceId,
          reason: props.reason,
          actorUserId: props.actorUserId,
          correlationId: props.correlationId,
        },
      );

      return { item: inventoryItemToDomain(item), ledgerEntry: ledgerEntryToDomain(ledgerEntry) };
    });
  }
}

function toDomain(row: PrismaInventoryItem): InventoryItem {
  return InventoryItem.create({
    id: row.id,
    productSkuId: row.productSkuId,
    warehouseId: row.warehouseId,
    locationId: row.locationId,
    onHandQuantity: row.onHandQuantity,
    reservedQuantity: row.reservedQuantity,
    availableQuantity: row.availableQuantity,
    inTransitQuantity: row.inTransitQuantity,
    damagedQuantity: row.damagedQuantity,
    quarantinedQuantity: row.quarantinedQuantity,
    blockedQuantity: row.blockedQuantity,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
