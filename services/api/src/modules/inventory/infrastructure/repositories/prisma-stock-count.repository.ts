import { randomUUID } from 'node:crypto';

import {
  prisma,
  type StockCount as PrismaStockCount,
  type StockCountItem as PrismaStockCountItem,
} from '@iecp/database';
import type { StockCountStatus, WarehouseId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { StockCountItem } from '../../domain/entities/stock-count-item.entity';
import { StockCount } from '../../domain/entities/stock-count.entity';
import type {
  StockCountRepositoryPort,
  StockCountWithItems,
} from '../../domain/ports/stock-count.repository.port';
import { StockCountVarianceCalculator } from '../../domain/services/stock-count-variance-calculator';
import { mutateInventoryItem } from '../inventory-item-mutator';
import { decodeCursor, encodeCursor, splitPage } from '../pagination.util';

@Injectable()
export class PrismaStockCountRepository implements StockCountRepositoryPort {
  async findById(id: string): Promise<StockCountWithItems | null> {
    const stockCount = await prisma.stockCount.findUnique({ where: { id } });
    if (!stockCount) return null;
    const items = await prisma.stockCountItem.findMany({ where: { stockCountId: id } });
    return { stockCount: toDomain(stockCount), items: items.map(itemToDomain) };
  }

  async list(filter: {
    warehouseId?: WarehouseId;
    status?: StockCountStatus;
    cursor?: string;
    limit: number;
  }): Promise<{ items: StockCount[]; nextCursor: string | null }> {
    const cursorClause = filter.cursor ? decodeCursor(filter.cursor) : null;
    const where = {
      ...(filter.warehouseId !== undefined && { warehouseId: filter.warehouseId }),
      ...(filter.status !== undefined && { status: filter.status }),
    };
    const rows = await prisma.stockCount.findMany({
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
    warehouseId: string;
    locationId?: string | null;
    productSkuIds: string[];
  }): Promise<StockCountWithItems> {
    if (props.productSkuIds.length === 0) {
      throw new Error('A stock count must include at least one SKU');
    }
    return prisma.$transaction(async (tx) => {
      const stockCount = await tx.stockCount.create({
        data: {
          id: randomUUID(),
          warehouseId: props.warehouseId,
          locationId: props.locationId ?? null,
          status: 'PLANNED',
        },
      });

      const items = await Promise.all(
        props.productSkuIds.map(async (productSkuId) => {
          const inventoryItems = await tx.inventoryItem.findMany({
            where: {
              productSkuId,
              warehouseId: props.warehouseId,
              ...(props.locationId ? { locationId: props.locationId } : {}),
            },
          });
          const expectedQuantity = inventoryItems.reduce(
            (sum, item) => sum + item.onHandQuantity,
            0,
          );
          return tx.stockCountItem.create({
            data: {
              id: randomUUID(),
              stockCountId: stockCount.id,
              productSkuId,
              expectedQuantity,
            },
          });
        }),
      );
      return { stockCount: toDomain(stockCount), items: items.map(itemToDomain) };
    });
  }

  async submit(
    id: string,
    props: { countedBy: string; items: { productSkuId: string; countedQuantity: number }[] },
  ): Promise<StockCountWithItems> {
    return prisma.$transaction(async (tx) => {
      const stockCount = await tx.stockCount.findUniqueOrThrow({ where: { id } });
      if (!['PLANNED', 'IN_PROGRESS'].includes(stockCount.status)) {
        throw new Error(`Stock count ${id} cannot be submitted from status ${stockCount.status}`);
      }

      const existingItems = await tx.stockCountItem.findMany({ where: { stockCountId: id } });
      const countedBySkuId = new Map(props.items.map((i) => [i.productSkuId, i.countedQuantity]));

      await Promise.all(
        existingItems.map((item) => {
          const countedQuantity = countedBySkuId.get(item.productSkuId);
          if (countedQuantity === undefined) return Promise.resolve();
          const variance = StockCountVarianceCalculator.compute(
            item.expectedQuantity,
            countedQuantity,
          );
          return tx.stockCountItem.update({
            where: { id: item.id },
            data: { countedQuantity, variance },
          });
        }),
      );

      const updated = await tx.stockCount.update({
        where: { id },
        data: { status: 'COUNTED', countedBy: props.countedBy, completedAt: new Date() },
      });
      const items = await tx.stockCountItem.findMany({ where: { stockCountId: id } });
      return { stockCount: toDomain(updated), items: items.map(itemToDomain) };
    });
  }

  async approve(
    id: string,
    props: { approvedBy: string; correlationId: string },
  ): Promise<StockCountWithItems> {
    return prisma.$transaction(async (tx) => {
      const stockCount = await tx.stockCount.findUniqueOrThrow({ where: { id } });
      if (!['COUNTED', 'UNDER_REVIEW'].includes(stockCount.status)) {
        throw new Error(`Stock count ${id} cannot be approved from status ${stockCount.status}`);
      }

      const items = await tx.stockCountItem.findMany({ where: { stockCountId: id } });
      for (const item of items) {
        if (!item.variance) continue;

        const candidates = await tx.inventoryItem.findMany({
          where: {
            productSkuId: item.productSkuId,
            warehouseId: stockCount.warehouseId,
            ...(stockCount.locationId ? { locationId: stockCount.locationId } : {}),
          },
          orderBy: { onHandQuantity: 'desc' },
        });
        const target = candidates[0];
        if (!target) continue;

        await mutateInventoryItem(tx, target.id, { onHand: item.variance }, 'COUNT_ADJUSTMENT', {
          quantity: Math.abs(item.variance),
          referenceType: 'STOCK_COUNT',
          referenceId: id,
          reason: `Stock count reconciliation (expected ${item.expectedQuantity}, counted ${item.countedQuantity ?? 0})`,
          actorUserId: props.approvedBy,
          correlationId: props.correlationId,
        });
      }

      const updated = await tx.stockCount.update({
        where: { id },
        data: { status: 'APPROVED', approvedBy: props.approvedBy },
      });
      return { stockCount: toDomain(updated), items: items.map(itemToDomain) };
    });
  }

  async reject(id: string, props: { approvedBy: string }): Promise<StockCountWithItems> {
    const updated = await prisma.stockCount.update({
      where: { id },
      data: { status: 'REJECTED', approvedBy: props.approvedBy },
    });
    const items = await prisma.stockCountItem.findMany({ where: { stockCountId: id } });
    return { stockCount: toDomain(updated), items: items.map(itemToDomain) };
  }
}

function toDomain(row: PrismaStockCount): StockCount {
  return StockCount.create({
    id: row.id,
    warehouseId: row.warehouseId,
    locationId: row.locationId,
    status: row.status,
    countedBy: row.countedBy,
    approvedBy: row.approvedBy,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function itemToDomain(row: PrismaStockCountItem): StockCountItem {
  return StockCountItem.create({
    id: row.id,
    stockCountId: row.stockCountId,
    productSkuId: row.productSkuId,
    expectedQuantity: row.expectedQuantity,
    countedQuantity: row.countedQuantity,
    variance: row.variance,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
