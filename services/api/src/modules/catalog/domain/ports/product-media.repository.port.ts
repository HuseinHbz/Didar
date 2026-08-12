import type { LocalizedText, MediaRole, ProductId, ProductVariantId } from '@iecp/types';

import type { ProductMedia } from '../entities/product-media.entity';

export const PRODUCT_MEDIA_REPOSITORY = Symbol('PRODUCT_MEDIA_REPOSITORY');

export interface ProductMediaRepositoryPort {
  listByProduct(productId: ProductId): Promise<ProductMedia[]>;
  attach(props: {
    productId: string;
    variantId?: string | null;
    mediaId: string;
    role?: MediaRole;
    sortOrder?: number;
    altTextOverride?: LocalizedText | null;
  }): Promise<ProductMedia>;
  detach(id: string): Promise<void>;
  reorder(productId: ProductId, orderedIds: string[]): Promise<void>;
  /** Enforced at the application layer (see ADR-005 — no DB-level partial
   * unique index): clears any existing PRIMARY on this product/variant
   * scope before a new one is set. */
  clearPrimary(productId: ProductId, variantId: ProductVariantId | null): Promise<void>;
}
