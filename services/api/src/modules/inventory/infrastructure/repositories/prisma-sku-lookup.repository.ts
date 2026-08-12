import { prisma } from '@iecp/database';
import type { ProductSkuId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import type { SkuLookupPort, SkuLookupResult } from '../../domain/ports/sku-lookup.port';

@Injectable()
export class PrismaSkuLookupRepository implements SkuLookupPort {
  async findById(id: ProductSkuId): Promise<SkuLookupResult | null> {
    const row = await prisma.productSku.findUnique({ where: { id }, include: { product: true } });
    return row ? toResult(row) : null;
  }

  async findByBarcode(barcode: string): Promise<SkuLookupResult | null> {
    const row = await prisma.productSku.findUnique({
      where: { barcode },
      include: { product: true },
    });
    return row ? toResult(row) : null;
  }

  async findBySkuCode(skuCode: string): Promise<SkuLookupResult | null> {
    const row = await prisma.productSku.findUnique({
      where: { skuCode },
      include: { product: true },
    });
    return row ? toResult(row) : null;
  }

  async findByProductSlug(productSlug: string): Promise<SkuLookupResult[]> {
    const rows = await prisma.productSku.findMany({
      where: { product: { slug: productSlug } },
      include: { product: true },
    });
    return rows.map(toResult);
  }
}

function toResult(row: {
  id: string;
  skuCode: string;
  barcode: string | null;
  productId: string;
  product: { slug: string };
}): SkuLookupResult {
  return {
    id: row.id as ProductSkuId,
    skuCode: row.skuCode,
    barcode: row.barcode,
    productId: row.productId,
    productSlug: row.product.slug,
  };
}
