import type {
  CatalogStatus,
  CollectionId,
  CollectionRules,
  CollectionType,
  LocalizedText,
  SeoMetadata,
} from '@iecp/types';

import type { Collection } from '../entities/collection.entity';

export const COLLECTION_REPOSITORY = Symbol('COLLECTION_REPOSITORY');

export interface ListCollectionsFilter {
  status?: CatalogStatus;
  type?: CollectionType;
  cursor?: string;
  limit: number;
}

export interface CollectionRepositoryPort {
  findById(id: CollectionId): Promise<Collection | null>;
  findBySlug(slug: string): Promise<Collection | null>;
  existsBySlug(slug: string): Promise<boolean>;
  list(filter: ListCollectionsFilter): Promise<{ items: Collection[]; nextCursor: string | null }>;
  create(props: {
    name: string;
    slug: string;
    localizedName?: LocalizedText | null;
    description?: string | null;
    type?: CollectionType;
    rules?: CollectionRules | null;
    priority?: number;
    startAt?: Date | null;
    endAt?: Date | null;
    imageMediaId?: string | null;
    seo?: SeoMetadata | null;
  }): Promise<Collection>;
  update(
    id: CollectionId,
    props: Partial<{
      name: string;
      slug: string;
      localizedName: LocalizedText | null;
      description: string | null;
      type: CollectionType;
      rules: CollectionRules | null;
      priority: number;
      startAt: Date | null;
      endAt: Date | null;
      status: CatalogStatus;
      publishedAt: Date | null;
      imageMediaId: string | null;
      seo: SeoMetadata | null;
    }>,
  ): Promise<Collection>;
  softDelete(id: CollectionId): Promise<void>;

  /** MANUAL collections only. */
  listProductIds(id: CollectionId): Promise<string[]>;
  addProduct(id: CollectionId, productId: string, sortOrder?: number): Promise<void>;
  removeProduct(id: CollectionId, productId: string): Promise<void>;
  reorderProducts(id: CollectionId, orderedProductIds: string[]): Promise<void>;

  /** DYNAMIC collections — resolves membership via `rules` at query time
   * (ADR-005 decision 4), paginated the same way a MANUAL listing is. */
  listDynamicMemberProductIds(
    rules: CollectionRules,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: string[]; nextCursor: string | null }>;
}
