import {
  prisma,
  type PriceHistory as PrismaPriceHistory,
  type ProductPrice as PrismaProductPrice,
} from '@iecp/database';
import type { ProductSkuId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { PriceHistoryEntry } from '../../domain/entities/price-history-entry.entity';
import { ProductPrice } from '../../domain/entities/product-price.entity';
import type { PricingRepositoryPort } from '../../domain/ports/pricing.repository.port';
import { decodeCursor, encodeCursor, splitPage } from '../pagination.util';

@Injectable()
export class PrismaPricingRepository implements PricingRepositoryPort {
  async findBySkuId(skuId: ProductSkuId): Promise<ProductPrice | null> {
    const row = await prisma.productPrice.findUnique({ where: { productSkuId: skuId } });
    return row ? priceToDomain(row) : null;
  }

  async findManyBySkuIds(skuIds: ProductSkuId[]): Promise<ProductPrice[]> {
    if (skuIds.length === 0) return [];
    const rows = await prisma.productPrice.findMany({ where: { productSkuId: { in: skuIds } } });
    return rows.map(priceToDomain);
  }

  async setPrice(props: {
    productSkuId: string;
    basePrice: bigint;
    compareAtPrice?: bigint | null;
    costPrice?: bigint | null;
    currency?: string;
    validFrom?: Date | null;
    validTo?: Date | null;
    changedBy?: string | null;
    reason?: string | null;
  }): Promise<ProductPrice> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.productPrice.findUnique({
        where: { productSkuId: props.productSkuId },
      });

      const row = await tx.productPrice.upsert({
        where: { productSkuId: props.productSkuId },
        update: {
          basePrice: props.basePrice,
          compareAtPrice: props.compareAtPrice ?? null,
          costPrice: props.costPrice ?? null,
          ...(props.currency !== undefined && { currency: props.currency }),
          validFrom: props.validFrom ?? null,
          validTo: props.validTo ?? null,
        },
        create: {
          productSkuId: props.productSkuId,
          basePrice: props.basePrice,
          compareAtPrice: props.compareAtPrice ?? null,
          costPrice: props.costPrice ?? null,
          currency: props.currency ?? 'IRR',
          validFrom: props.validFrom ?? null,
          validTo: props.validTo ?? null,
        },
      });

      // Append-only trail (blueprint §13) — every setPrice call writes one
      // history row, never a silent overwrite, even when nothing changed.
      await tx.priceHistory.create({
        data: {
          productSkuId: props.productSkuId,
          oldPrice: existing?.basePrice ?? null,
          newPrice: props.basePrice,
          changedBy: props.changedBy ?? null,
          reason: props.reason ?? null,
        },
      });

      return priceToDomain(row);
    });
  }

  async listHistory(
    skuId: ProductSkuId,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: PriceHistoryEntry[]; nextCursor: string | null }> {
    const where = { productSkuId: skuId } as const;
    const cursorClause = pagination.cursor ? decodeCursor(pagination.cursor) : null;

    const rows = await prisma.priceHistory.findMany({
      where: cursorClause
        ? {
            ...where,
            OR: [
              { changedAt: { lt: new Date(cursorClause.sortValue) } },
              { changedAt: new Date(cursorClause.sortValue), id: { lt: cursorClause.id } },
            ],
          }
        : where,
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    });

    const { page, hasMore } = splitPage(rows, pagination.limit);
    const last = page.at(-1);

    return {
      items: page.map(historyToDomain),
      nextCursor: hasMore && last ? encodeCursor(last.changedAt.toISOString(), last.id) : null,
    };
  }
}

function priceToDomain(row: PrismaProductPrice): ProductPrice {
  return ProductPrice.create({
    id: row.id,
    productSkuId: row.productSkuId,
    basePrice: row.basePrice,
    compareAtPrice: row.compareAtPrice,
    costPrice: row.costPrice,
    currency: row.currency,
    validFrom: row.validFrom,
    validTo: row.validTo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function historyToDomain(row: PrismaPriceHistory): PriceHistoryEntry {
  return PriceHistoryEntry.create({
    id: row.id,
    productSkuId: row.productSkuId,
    oldPrice: row.oldPrice,
    newPrice: row.newPrice,
    changedBy: row.changedBy,
    reason: row.reason,
    changedAt: row.changedAt,
  });
}
