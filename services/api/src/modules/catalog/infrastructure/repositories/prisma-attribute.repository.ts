import {
  prisma,
  type ProductAttribute as PrismaProductAttribute,
  type ProductAttributeValue as PrismaProductAttributeValue,
} from '@iecp/database';
import type {
  LocalizedText,
  ProductAttributeId,
  ProductAttributeValueId,
  ProductVariantId,
} from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { ProductAttributeValue } from '../../domain/entities/product-attribute-value.entity';
import { ProductAttribute } from '../../domain/entities/product-attribute.entity';
import type { AttributeRepositoryPort } from '../../domain/ports/attribute.repository.port';
import { fromJson, toJson } from '../json.util';

@Injectable()
export class PrismaAttributeRepository implements AttributeRepositoryPort {
  async listAttributes(filterableOnly?: boolean): Promise<ProductAttribute[]> {
    const rows = await prisma.productAttribute.findMany({
      where: filterableOnly ? { isFilterable: true } : undefined,
      orderBy: { name: 'asc' },
    });
    return rows.map(attributeToDomain);
  }

  async findAttributeById(id: ProductAttributeId): Promise<ProductAttribute | null> {
    const row = await prisma.productAttribute.findUnique({ where: { id } });
    return row ? attributeToDomain(row) : null;
  }

  async findAttributeByKey(key: string): Promise<ProductAttribute | null> {
    const row = await prisma.productAttribute.findUnique({ where: { key } });
    return row ? attributeToDomain(row) : null;
  }

  async createAttribute(props: {
    key: string;
    name: string;
    localizedName?: LocalizedText | null;
    isFilterable?: boolean;
  }): Promise<ProductAttribute> {
    const row = await prisma.productAttribute.create({
      data: {
        key: props.key,
        name: props.name,
        localizedName: toJson(props.localizedName ?? null),
        isFilterable: props.isFilterable ?? true,
      },
    });
    return attributeToDomain(row);
  }

  async listValues(attributeId: ProductAttributeId): Promise<ProductAttributeValue[]> {
    const rows = await prisma.productAttributeValue.findMany({
      where: { attributeId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(valueToDomain);
  }

  async findValueById(id: ProductAttributeValueId): Promise<ProductAttributeValue | null> {
    const row = await prisma.productAttributeValue.findUnique({ where: { id } });
    return row ? valueToDomain(row) : null;
  }

  async createValue(props: {
    attributeId: string;
    value: string;
    localizedValue?: LocalizedText | null;
    sortOrder?: number;
  }): Promise<ProductAttributeValue> {
    const row = await prisma.productAttributeValue.create({
      data: {
        attributeId: props.attributeId,
        value: props.value,
        localizedValue: toJson(props.localizedValue ?? null),
        sortOrder: props.sortOrder ?? 0,
      },
    });
    return valueToDomain(row);
  }

  async listVariantAssignments(
    variantId: ProductVariantId,
  ): Promise<{ attributeId: string; attributeValueId: string }[]> {
    const rows = await prisma.productVariantAttributeValue.findMany({
      where: { variantId },
      include: { attributeValue: { select: { attributeId: true } } },
    });
    return rows.map((row) => ({
      attributeId: row.attributeValue.attributeId,
      attributeValueId: row.attributeValueId,
    }));
  }

  async assignToVariant(
    variantId: ProductVariantId,
    attributeValueId: ProductAttributeValueId,
  ): Promise<void> {
    await prisma.productVariantAttributeValue.upsert({
      where: { variantId_attributeValueId: { variantId, attributeValueId } },
      update: {},
      create: { variantId, attributeValueId },
    });
  }

  async unassignFromVariant(
    variantId: ProductVariantId,
    attributeValueId: ProductAttributeValueId,
  ): Promise<void> {
    await prisma.productVariantAttributeValue.deleteMany({
      where: { variantId, attributeValueId },
    });
  }
}

function attributeToDomain(row: PrismaProductAttribute): ProductAttribute {
  return ProductAttribute.create({
    id: row.id,
    key: row.key,
    name: row.name,
    localizedName: fromJson(row.localizedName),
    isFilterable: row.isFilterable,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function valueToDomain(row: PrismaProductAttributeValue): ProductAttributeValue {
  return ProductAttributeValue.create({
    id: row.id,
    attributeId: row.attributeId,
    value: row.value,
    localizedValue: fromJson(row.localizedValue),
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  });
}
