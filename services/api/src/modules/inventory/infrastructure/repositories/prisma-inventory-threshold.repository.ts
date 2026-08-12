import { prisma, type InventoryThreshold as PrismaInventoryThreshold } from '@iecp/database';
import type { ProductSkuId, WarehouseId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { InventoryThreshold } from '../../domain/entities/inventory-threshold.entity';
import type {
  InventoryThresholdRepositoryPort,
  LowStockRow,
} from '../../domain/ports/inventory-threshold.repository.port';
import { AvailableQuantityCalculator } from '../../domain/services/available-quantity-calculator';
import { LowStockEvaluator } from '../../domain/services/low-stock-evaluator';

@Injectable()
export class PrismaInventoryThresholdRepository implements InventoryThresholdRepositoryPort {
  async findBySkuWarehouse(
    skuId: ProductSkuId,
    warehouseId: WarehouseId,
  ): Promise<InventoryThreshold | null> {
    const row = await prisma.inventoryThreshold.findUnique({
      where: { productSkuId_warehouseId: { productSkuId: skuId, warehouseId } },
    });
    return row ? toDomain(row) : null;
  }

  async listLowStock(warehouseId?: WarehouseId): Promise<LowStockRow[]> {
    const thresholds = await prisma.inventoryThreshold.findMany({
      where: warehouseId ? { warehouseId } : undefined,
    });
    if (thresholds.length === 0) return [];

    const items = await prisma.inventoryItem.findMany({
      where: {
        OR: thresholds.map((t) => ({ productSkuId: t.productSkuId, warehouseId: t.warehouseId })),
      },
    });

    const results: LowStockRow[] = [];
    for (const threshold of thresholds) {
      const availableQuantity = items
        .filter(
          (i) =>
            i.productSkuId === threshold.productSkuId && i.warehouseId === threshold.warehouseId,
        )
        .reduce((sum, i) => sum + AvailableQuantityCalculator.compute(i), 0);
      const evaluation = LowStockEvaluator.evaluate(availableQuantity, threshold);
      if (evaluation.isLow) {
        results.push({ threshold: toDomain(threshold), availableQuantity });
      }
    }
    return results;
  }

  async upsert(props: {
    productSkuId: string;
    warehouseId: string;
    reorderPoint?: number;
    safetyStock?: number;
    minStock?: number | null;
    maxStock?: number | null;
  }): Promise<InventoryThreshold> {
    const row = await prisma.inventoryThreshold.upsert({
      where: {
        productSkuId_warehouseId: {
          productSkuId: props.productSkuId,
          warehouseId: props.warehouseId,
        },
      },
      update: {
        ...(props.reorderPoint !== undefined && { reorderPoint: props.reorderPoint }),
        ...(props.safetyStock !== undefined && { safetyStock: props.safetyStock }),
        ...(props.minStock !== undefined && { minStock: props.minStock }),
        ...(props.maxStock !== undefined && { maxStock: props.maxStock }),
      },
      create: {
        productSkuId: props.productSkuId,
        warehouseId: props.warehouseId,
        reorderPoint: props.reorderPoint ?? 0,
        safetyStock: props.safetyStock ?? 0,
        minStock: props.minStock ?? null,
        maxStock: props.maxStock ?? null,
      },
    });
    return toDomain(row);
  }
}

function toDomain(row: PrismaInventoryThreshold): InventoryThreshold {
  return InventoryThreshold.create({
    id: row.id,
    productSkuId: row.productSkuId,
    warehouseId: row.warehouseId,
    reorderPoint: row.reorderPoint,
    safetyStock: row.safetyStock,
    minStock: row.minStock,
    maxStock: row.maxStock,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
