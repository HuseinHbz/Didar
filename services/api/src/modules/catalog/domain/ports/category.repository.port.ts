import type { CatalogStatus, CategoryId, LocalizedText, SeoMetadata } from '@iecp/types';

import type { Category } from '../entities/category.entity';
import type { CategoryNode } from '../services/category-hierarchy';

export const CATEGORY_REPOSITORY = Symbol('CATEGORY_REPOSITORY');

export interface ListCategoriesFilter {
  parentId?: string | null;
  status?: CatalogStatus;
  cursor?: string;
  limit: number;
}

export interface CategoryRepositoryPort {
  findById(id: CategoryId): Promise<Category | null>;
  findBySlug(slug: string): Promise<Category | null>;
  existsBySlug(slug: string): Promise<boolean>;
  list(filter: ListCategoriesFilter): Promise<{ items: Category[]; nextCursor: string | null }>;
  /** Every category as `{id, parentId}` — feeds CategoryHierarchyService. */
  listAllNodes(): Promise<CategoryNode[]>;
  create(props: {
    parentId?: string | null;
    name: string;
    slug: string;
    localizedName?: LocalizedText | null;
    description?: string | null;
    imageMediaId?: string | null;
    sortOrder?: number;
    seo?: SeoMetadata | null;
  }): Promise<Category>;
  update(
    id: CategoryId,
    props: Partial<{
      parentId: string | null;
      name: string;
      slug: string;
      localizedName: LocalizedText | null;
      description: string | null;
      imageMediaId: string | null;
      status: CatalogStatus;
      publishedAt: Date | null;
      sortOrder: number;
      seo: SeoMetadata | null;
    }>,
  ): Promise<Category>;
  softDelete(id: CategoryId): Promise<void>;
  hasChildren(id: CategoryId): Promise<boolean>;
  hasProducts(id: CategoryId): Promise<boolean>;
}
