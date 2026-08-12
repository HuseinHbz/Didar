import type {
  LocalizedText,
  ProductId,
  ProductLifecycleStatus,
  ProductType,
  SeoMetadata,
} from '@iecp/types';

import type { Product } from '../entities/product.entity';

export const PRODUCT_REPOSITORY = Symbol('PRODUCT_REPOSITORY');

export type ProductSortField = 'createdAt' | 'publishedAt' | 'name';

export interface ListProductsFilter {
  brandId?: string;
  categoryId?: string;
  collectionId?: string;
  status?: ProductLifecycleStatus;
  productType?: ProductType;
  tags?: string[];
  /** Matches against name/localizedName/slug — Postgres ILIKE, see
   * ADR-005 decision 5 (no dedicated search engine this phase). */
  search?: string;
  sortField?: ProductSortField;
  sortDir?: 'asc' | 'desc';
  cursor?: string;
  limit: number;
}

export interface ProductRepositoryPort {
  findById(id: ProductId): Promise<Product | null>;
  findBySlug(slug: string): Promise<Product | null>;
  existsBySlug(slug: string): Promise<boolean>;
  list(filter: ListProductsFilter): Promise<{ items: Product[]; nextCursor: string | null }>;
  create(props: {
    productType: ProductType;
    brandId: string;
    categoryId: string;
    name: string;
    slug: string;
    localizedName?: LocalizedText | null;
    shortDescription?: string | null;
    longDescription?: string | null;
    specifications?: Record<string, unknown> | null;
    tags?: string[];
    arModelMediaId?: string | null;
    faceTryOnMetadata?: Record<string, unknown> | null;
    seo?: SeoMetadata | null;
  }): Promise<Product>;
  update(
    id: ProductId,
    props: Partial<{
      brandId: string;
      categoryId: string;
      name: string;
      slug: string;
      localizedName: LocalizedText | null;
      shortDescription: string | null;
      longDescription: string | null;
      specifications: Record<string, unknown> | null;
      tags: string[];
      arModelMediaId: string | null;
      faceTryOnMetadata: Record<string, unknown> | null;
      seo: SeoMetadata | null;
    }>,
  ): Promise<Product>;
  /** Status + the lifecycle timestamp/actor fields that go with it — kept
   * separate from `update` so the state machine's write path is explicit,
   * never bundled into a general content edit. */
  updateStatus(
    id: ProductId,
    props: {
      status: ProductLifecycleStatus;
      reviewedBy?: string | null;
      approvedBy?: string | null;
      approvedAt?: Date | null;
      publishedAt?: Date | null;
      unpublishedAt?: Date | null;
      archivedAt?: Date | null;
    },
  ): Promise<Product>;
  softDelete(id: ProductId): Promise<void>;
}
