import type { CatalogStatus, ProductGender, ProductId, ProductVariantId } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { ProductVariant } from '../domain/entities/product-variant.entity';
import {
  PRODUCT_VARIANT_REPOSITORY,
  type ProductVariantRepositoryPort,
} from '../domain/ports/product-variant.repository.port';

@Injectable()
export class VariantsService {
  constructor(
    @Inject(PRODUCT_VARIANT_REPOSITORY) private readonly variants: ProductVariantRepositoryPort,
  ) {}

  async get(id: ProductVariantId): Promise<ProductVariant> {
    const variant = await this.variants.findById(id);
    if (!variant) throw new NotFoundException('Variant not found');
    return variant;
  }

  listByProduct(productId: ProductId): Promise<ProductVariant[]> {
    return this.variants.listByProduct(productId);
  }

  async create(input: {
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
    const variant = await this.variants.create(input);
    if (input.isDefault) {
      await this.variants.clearDefaultForProduct(variant.productId, variant.id);
    }
    return variant;
  }

  async update(
    id: ProductVariantId,
    input: Partial<{
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
    const current = await this.get(id);
    const updated = await this.variants.update(id, input);
    if (input.isDefault) {
      await this.variants.clearDefaultForProduct(current.productId, id);
    }
    return updated;
  }

  async delete(id: ProductVariantId): Promise<void> {
    await this.get(id);
    await this.variants.softDelete(id);
  }
}
