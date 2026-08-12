import { prisma, type ProductSku as PrismaProductSku } from '@iecp/database';
import type { ProductId, ProductSkuId, ProductVariantId, SkuStatus } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { ProductSku } from '../../domain/entities/product-sku.entity';
import type { ProductSkuRepositoryPort } from '../../domain/ports/product-sku.repository.port';

@Injectable()
export class PrismaProductSkuRepository implements ProductSkuRepositoryPort {
  async findById(id: ProductSkuId): Promise<ProductSku | null> {
    const row = await prisma.productSku.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByVariantId(variantId: ProductVariantId): Promise<ProductSku | null> {
    const row = await prisma.productSku.findUnique({ where: { variantId } });
    return row ? toDomain(row) : null;
  }

  async findBySkuCode(skuCode: string): Promise<ProductSku | null> {
    const row = await prisma.productSku.findUnique({ where: { skuCode } });
    return row ? toDomain(row) : null;
  }

  async findByBarcode(barcode: string): Promise<ProductSku | null> {
    const row = await prisma.productSku.findUnique({ where: { barcode } });
    return row ? toDomain(row) : null;
  }

  async existsBySkuCode(skuCode: string): Promise<boolean> {
    const row = await prisma.productSku.findUnique({ where: { skuCode }, select: { id: true } });
    return row !== null;
  }

  async listByProduct(productId: ProductId): Promise<ProductSku[]> {
    const rows = await prisma.productSku.findMany({
      where: { productId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDomain);
  }

  async create(props: {
    productId: string;
    variantId: string;
    skuCode: string;
    barcode?: string | null;
    weightGrams?: number | null;
    lengthMm?: number | null;
    widthMm?: number | null;
    heightMm?: number | null;
    taxRateBasisPoints?: number | null;
    supplierRef?: string | null;
  }): Promise<ProductSku> {
    const row = await prisma.productSku.create({
      data: {
        productId: props.productId,
        variantId: props.variantId,
        skuCode: props.skuCode,
        barcode: props.barcode ?? null,
        weightGrams: props.weightGrams ?? null,
        lengthMm: props.lengthMm ?? null,
        widthMm: props.widthMm ?? null,
        heightMm: props.heightMm ?? null,
        taxRateBasisPoints: props.taxRateBasisPoints ?? null,
        supplierRef: props.supplierRef ?? null,
      },
    });
    return toDomain(row);
  }

  async update(
    id: ProductSkuId,
    props: Partial<{
      skuCode: string;
      barcode: string | null;
      status: SkuStatus;
      weightGrams: number | null;
      lengthMm: number | null;
      widthMm: number | null;
      heightMm: number | null;
      taxRateBasisPoints: number | null;
      supplierRef: string | null;
    }>,
  ): Promise<ProductSku> {
    const row = await prisma.productSku.update({
      where: { id },
      data: {
        ...(props.skuCode !== undefined && { skuCode: props.skuCode }),
        ...(props.barcode !== undefined && { barcode: props.barcode }),
        ...(props.status !== undefined && { status: props.status }),
        ...(props.weightGrams !== undefined && { weightGrams: props.weightGrams }),
        ...(props.lengthMm !== undefined && { lengthMm: props.lengthMm }),
        ...(props.widthMm !== undefined && { widthMm: props.widthMm }),
        ...(props.heightMm !== undefined && { heightMm: props.heightMm }),
        ...(props.taxRateBasisPoints !== undefined && {
          taxRateBasisPoints: props.taxRateBasisPoints,
        }),
        ...(props.supplierRef !== undefined && { supplierRef: props.supplierRef }),
      },
    });
    return toDomain(row);
  }

  async softDelete(id: ProductSkuId): Promise<void> {
    await prisma.productSku.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DISCONTINUED' },
    });
  }
}

function toDomain(row: PrismaProductSku): ProductSku {
  return ProductSku.create({
    id: row.id,
    productId: row.productId,
    variantId: row.variantId,
    skuCode: row.skuCode,
    barcode: row.barcode,
    status: row.status,
    weightGrams: row.weightGrams,
    lengthMm: row.lengthMm,
    widthMm: row.widthMm,
    heightMm: row.heightMm,
    taxRateBasisPoints: row.taxRateBasisPoints,
    supplierRef: row.supplierRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}
