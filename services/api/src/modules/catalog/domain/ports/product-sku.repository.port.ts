import type { ProductId, ProductSkuId, ProductVariantId, SkuStatus } from '@iecp/types';

import type { ProductSku } from '../entities/product-sku.entity';

export const PRODUCT_SKU_REPOSITORY = Symbol('PRODUCT_SKU_REPOSITORY');

export interface ProductSkuRepositoryPort {
  findById(id: ProductSkuId): Promise<ProductSku | null>;
  findByVariantId(variantId: ProductVariantId): Promise<ProductSku | null>;
  findBySkuCode(skuCode: string): Promise<ProductSku | null>;
  findByBarcode(barcode: string): Promise<ProductSku | null>;
  existsBySkuCode(skuCode: string): Promise<boolean>;
  listByProduct(productId: ProductId): Promise<ProductSku[]>;
  create(props: {
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
  }): Promise<ProductSku>;
  update(
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
  ): Promise<ProductSku>;
  softDelete(id: ProductSkuId): Promise<void>;
}
