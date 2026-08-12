import { prisma, type ProductMedia as PrismaProductMedia } from '@iecp/database';
import type { LocalizedText, MediaRole, ProductId, ProductVariantId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { ProductMedia } from '../../domain/entities/product-media.entity';
import type { ProductMediaRepositoryPort } from '../../domain/ports/product-media.repository.port';
import { fromJson, toJson } from '../json.util';

@Injectable()
export class PrismaProductMediaRepository implements ProductMediaRepositoryPort {
  async listByProduct(productId: ProductId): Promise<ProductMedia[]> {
    const rows = await prisma.productMedia.findMany({
      where: { productId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async attach(props: {
    productId: string;
    variantId?: string | null;
    mediaId: string;
    role?: MediaRole;
    sortOrder?: number;
    altTextOverride?: LocalizedText | null;
  }): Promise<ProductMedia> {
    const row = await prisma.productMedia.create({
      data: {
        productId: props.productId,
        variantId: props.variantId ?? null,
        mediaId: props.mediaId,
        role: props.role ?? 'GALLERY',
        sortOrder: props.sortOrder ?? 0,
        altTextOverride: toJson(props.altTextOverride ?? null),
      },
    });
    return toDomain(row);
  }

  async detach(id: string): Promise<void> {
    await prisma.productMedia.delete({ where: { id } });
  }

  async reorder(productId: ProductId, orderedIds: string[]): Promise<void> {
    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.productMedia.update({ where: { id, productId }, data: { sortOrder: index } }),
      ),
    );
  }

  async clearPrimary(productId: ProductId, variantId: ProductVariantId | null): Promise<void> {
    await prisma.productMedia.updateMany({
      where: { productId, variantId, role: 'PRIMARY' },
      data: { role: 'GALLERY' },
    });
  }
}

function toDomain(row: PrismaProductMedia): ProductMedia {
  return ProductMedia.create({
    id: row.id,
    productId: row.productId,
    variantId: row.variantId,
    mediaId: row.mediaId,
    role: row.role,
    sortOrder: row.sortOrder,
    altTextOverride: fromJson(row.altTextOverride),
    createdAt: row.createdAt,
  });
}
