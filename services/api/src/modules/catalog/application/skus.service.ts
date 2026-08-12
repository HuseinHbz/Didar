import type { ProductId, ProductSkuId, ProductVariantId, SkuStatus } from '@iecp/types';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { ProductSku } from '../domain/entities/product-sku.entity';
import {
  PRODUCT_SKU_REPOSITORY,
  type ProductSkuRepositoryPort,
} from '../domain/ports/product-sku.repository.port';
import {
  PRODUCT_VARIANT_REPOSITORY,
  type ProductVariantRepositoryPort,
} from '../domain/ports/product-variant.repository.port';

@Injectable()
export class SkusService {
  constructor(
    @Inject(PRODUCT_SKU_REPOSITORY) private readonly skus: ProductSkuRepositoryPort,
    @Inject(PRODUCT_VARIANT_REPOSITORY) private readonly variants: ProductVariantRepositoryPort,
  ) {}

  async get(id: ProductSkuId): Promise<ProductSku> {
    const sku = await this.skus.findById(id);
    if (!sku) throw new NotFoundException('SKU not found');
    return sku;
  }

  listByProduct(productId: ProductId): Promise<ProductSku[]> {
    return this.skus.listByProduct(productId);
  }

  async findBySkuCode(skuCode: string): Promise<ProductSku> {
    const sku = await this.skus.findBySkuCode(skuCode);
    if (!sku) throw new NotFoundException('SKU not found');
    return sku;
  }

  async findByBarcode(barcode: string): Promise<ProductSku> {
    const sku = await this.skus.findByBarcode(barcode);
    if (!sku) throw new NotFoundException('SKU not found');
    return sku;
  }

  async create(input: {
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
    const variant = await this.variants.findById(input.variantId as ProductVariantId);
    if (!variant) throw new NotFoundException('Variant not found');

    const existing = await this.skus.findByVariantId(variant.id);
    if (existing) {
      throw new ConflictException(
        'This variant already has a SKU — every variant is 1:1 with its SKU',
      );
    }
    if (await this.skus.existsBySkuCode(input.skuCode)) {
      throw new ConflictException(`SKU code "${input.skuCode}" is already in use`);
    }

    return this.skus.create(input);
  }

  async update(
    id: ProductSkuId,
    input: Partial<{
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
    const current = await this.get(id);
    if (input.skuCode !== undefined && input.skuCode !== current.skuCode) {
      if (await this.skus.existsBySkuCode(input.skuCode)) {
        throw new ConflictException(`SKU code "${input.skuCode}" is already in use`);
      }
    }
    return this.skus.update(id, input);
  }

  async delete(id: ProductSkuId): Promise<void> {
    await this.get(id);
    await this.skus.softDelete(id);
  }
}
