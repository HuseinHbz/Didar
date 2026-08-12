import type { ProductSkuId } from '@iecp/types';

export const SKU_LOOKUP_PORT = Symbol('SKU_LOOKUP_PORT');

export interface SkuLookupResult {
  id: ProductSkuId;
  skuCode: string;
  barcode: string | null;
  productId: string;
  productSlug: string;
}

/**
 * Read-only lookup into `catalog.product_skus` — deliberately not the full
 * `ProductSkuRepositoryPort` from `modules/catalog`. Reusing the Phase 005
 * SKU model means reading its `id`/`barcode`/product-identity columns, not
 * importing catalog's whole domain layer into inventory or duplicating its
 * entity (see the brief's own "without duplicating product identity").
 * The Prisma implementation queries `catalog.product_skus` directly
 * through the shared `prisma` client — the same cross-schema-read pattern
 * every other module in this repo already uses (see
 * docs/database/README.md's "Cross-schema references are intentionally
 * unenforced").
 */
export interface SkuLookupPort {
  findById(id: ProductSkuId): Promise<SkuLookupResult | null>;
  findByBarcode(barcode: string): Promise<SkuLookupResult | null>;
  findBySkuCode(skuCode: string): Promise<SkuLookupResult | null>;
  /** Every SKU belonging to a product, by the product's slug — the
   * storefront `GET /catalog/products/:slug/availability` seam, which
   * reports on the whole product, not one SKU. */
  findByProductSlug(productSlug: string): Promise<SkuLookupResult[]>;
}
