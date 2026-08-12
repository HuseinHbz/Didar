import { prisma, type ProductVariant as PrismaProductVariant } from '@iecp/database';
import type { CatalogStatus, ProductGender, ProductId, ProductVariantId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { ProductVariant } from '../../domain/entities/product-variant.entity';
import type { ProductVariantRepositoryPort } from '../../domain/ports/product-variant.repository.port';

@Injectable()
export class PrismaProductVariantRepository implements ProductVariantRepositoryPort {
  async findById(id: ProductVariantId): Promise<ProductVariant | null> {
    const row = await prisma.productVariant.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async listByProduct(productId: ProductId): Promise<ProductVariant[]> {
    const rows = await prisma.productVariant.findMany({
      where: { productId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async create(props: {
    productId: string;
    label?: string | null;
    color?: string | null;
    colorHex?: string | null;
    size?: string | null;
    frameShape?: string | null;
    frameMaterial?: string | null;
    frameWidthMm?: number | null;
    bridgeWidthMm?: number | null;
    templeLengthMm?: number | null;
    lensWidthMm?: number | null;
    fit?: string | null;
    gender?: ProductGender | null;
    style?: string | null;
    lensCompatibility?: string[];
    isDefault?: boolean;
    sortOrder?: number;
  }): Promise<ProductVariant> {
    const row = await prisma.productVariant.create({
      data: {
        productId: props.productId,
        label: props.label ?? null,
        color: props.color ?? null,
        colorHex: props.colorHex ?? null,
        size: props.size ?? null,
        frameShape: props.frameShape ?? null,
        frameMaterial: props.frameMaterial ?? null,
        frameWidthMm: props.frameWidthMm ?? null,
        bridgeWidthMm: props.bridgeWidthMm ?? null,
        templeLengthMm: props.templeLengthMm ?? null,
        lensWidthMm: props.lensWidthMm ?? null,
        fit: props.fit ?? null,
        gender: props.gender ?? null,
        style: props.style ?? null,
        lensCompatibility: props.lensCompatibility ?? [],
        isDefault: props.isDefault ?? false,
        sortOrder: props.sortOrder ?? 0,
      },
    });
    return toDomain(row);
  }

  async update(
    id: ProductVariantId,
    props: Partial<{
      label: string | null;
      color: string | null;
      colorHex: string | null;
      size: string | null;
      frameShape: string | null;
      frameMaterial: string | null;
      frameWidthMm: number | null;
      bridgeWidthMm: number | null;
      templeLengthMm: number | null;
      lensWidthMm: number | null;
      fit: string | null;
      gender: ProductGender | null;
      style: string | null;
      lensCompatibility: string[];
      isDefault: boolean;
      status: CatalogStatus;
      sortOrder: number;
    }>,
  ): Promise<ProductVariant> {
    const row = await prisma.productVariant.update({
      where: { id },
      data: {
        ...(props.label !== undefined && { label: props.label }),
        ...(props.color !== undefined && { color: props.color }),
        ...(props.colorHex !== undefined && { colorHex: props.colorHex }),
        ...(props.size !== undefined && { size: props.size }),
        ...(props.frameShape !== undefined && { frameShape: props.frameShape }),
        ...(props.frameMaterial !== undefined && { frameMaterial: props.frameMaterial }),
        ...(props.frameWidthMm !== undefined && { frameWidthMm: props.frameWidthMm }),
        ...(props.bridgeWidthMm !== undefined && { bridgeWidthMm: props.bridgeWidthMm }),
        ...(props.templeLengthMm !== undefined && { templeLengthMm: props.templeLengthMm }),
        ...(props.lensWidthMm !== undefined && { lensWidthMm: props.lensWidthMm }),
        ...(props.fit !== undefined && { fit: props.fit }),
        ...(props.gender !== undefined && { gender: props.gender }),
        ...(props.style !== undefined && { style: props.style }),
        ...(props.lensCompatibility !== undefined && {
          lensCompatibility: props.lensCompatibility,
        }),
        ...(props.isDefault !== undefined && { isDefault: props.isDefault }),
        ...(props.status !== undefined && { status: props.status }),
        ...(props.sortOrder !== undefined && { sortOrder: props.sortOrder }),
      },
    });
    return toDomain(row);
  }

  async softDelete(id: ProductVariantId): Promise<void> {
    await prisma.productVariant.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
  }

  async clearDefaultForProduct(
    productId: ProductId,
    exceptVariantId?: ProductVariantId,
  ): Promise<void> {
    await prisma.productVariant.updateMany({
      where: {
        productId,
        isDefault: true,
        ...(exceptVariantId && { id: { not: exceptVariantId } }),
      },
      data: { isDefault: false },
    });
  }
}

function toDomain(row: PrismaProductVariant): ProductVariant {
  return ProductVariant.create({
    id: row.id,
    productId: row.productId,
    label: row.label,
    color: row.color,
    colorHex: row.colorHex,
    size: row.size,
    frameShape: row.frameShape,
    frameMaterial: row.frameMaterial,
    frameWidthMm: row.frameWidthMm,
    bridgeWidthMm: row.bridgeWidthMm,
    templeLengthMm: row.templeLengthMm,
    lensWidthMm: row.lensWidthMm,
    fit: row.fit,
    gender: row.gender,
    style: row.style,
    lensCompatibility: row.lensCompatibility,
    isDefault: row.isDefault,
    status: row.status,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}
