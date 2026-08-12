import type { ProductSkuId } from '@iecp/types';

import type { PriceHistoryEntry } from '../entities/price-history-entry.entity';
import type { ProductPrice } from '../entities/product-price.entity';

export const PRICING_REPOSITORY = Symbol('PRICING_REPOSITORY');

export interface PricingRepositoryPort {
  findBySkuId(skuId: ProductSkuId): Promise<ProductPrice | null>;
  findManyBySkuIds(skuIds: ProductSkuId[]): Promise<ProductPrice[]>;
  /**
   * Upserts the SKU's single price row (blueprint §12 — exactly one active
   * price row per SKU) and appends a `PriceHistory` row in the same
   * operation — changes never go through a silent overwrite, see that
   * entity's own doc comment.
   */
  setPrice(props: {
    productSkuId: string;
    basePrice: bigint;
    compareAtPrice?: bigint | null;
    costPrice?: bigint | null;
    currency?: string;
    validFrom?: Date | null;
    validTo?: Date | null;
    changedBy?: string | null;
    reason?: string | null;
  }): Promise<ProductPrice>;
  listHistory(
    skuId: ProductSkuId,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: PriceHistoryEntry[]; nextCursor: string | null }>;
}
