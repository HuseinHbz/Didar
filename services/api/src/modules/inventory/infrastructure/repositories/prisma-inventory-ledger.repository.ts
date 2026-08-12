import { prisma } from '@iecp/database';
import type { ProductSkuId, WarehouseId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import type { InventoryLedgerEntry } from '../../domain/entities/inventory-ledger-entry.entity';
import type { InventoryLedgerRepositoryPort } from '../../domain/ports/inventory-ledger.repository.port';
import { ledgerEntryToDomain } from '../ledger-entry.mapper';
import { decodeCursor, encodeCursor, splitPage } from '../pagination.util';

@Injectable()
export class PrismaInventoryLedgerRepository implements InventoryLedgerRepositoryPort {
  async listBySku(
    skuId: ProductSkuId,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: InventoryLedgerEntry[]; nextCursor: string | null }> {
    return this.listWithCursor({ productSkuId: skuId }, pagination);
  }

  async listByWarehouse(
    warehouseId: WarehouseId,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: InventoryLedgerEntry[]; nextCursor: string | null }> {
    return this.listWithCursor({ warehouseId }, pagination);
  }

  async listByReference(
    referenceType: string,
    referenceId: string,
  ): Promise<InventoryLedgerEntry[]> {
    const rows = await prisma.inventoryLedger.findMany({
      where: { referenceType, referenceId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(ledgerEntryToDomain);
  }

  private async listWithCursor(
    where: { productSkuId?: ProductSkuId; warehouseId?: WarehouseId },
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: InventoryLedgerEntry[]; nextCursor: string | null }> {
    const cursorClause = pagination.cursor ? decodeCursor(pagination.cursor) : null;

    const rows = await prisma.inventoryLedger.findMany({
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
      items: page.map(ledgerEntryToDomain),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt.toISOString(), last.id) : null,
    };
  }
}
