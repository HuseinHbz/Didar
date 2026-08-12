import type { CatalogStatus, ProductGender, ProductId, ProductVariantId } from '@iecp/types';

import type { ProductVariant } from '../entities/product-variant.entity';

export const PRODUCT_VARIANT_REPOSITORY = Symbol('PRODUCT_VARIANT_REPOSITORY');

export interface ProductVariantRepositoryPort {
  findById(id: ProductVariantId): Promise<ProductVariant | null>;
  listByProduct(productId: ProductId): Promise<ProductVariant[]>;
  create(props: {
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
  }): Promise<ProductVariant>;
  update(
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
  ): Promise<ProductVariant>;
  softDelete(id: ProductVariantId): Promise<void>;
  clearDefaultForProduct(productId: ProductId, exceptVariantId?: ProductVariantId): Promise<void>;
}
