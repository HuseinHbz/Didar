import type { BrandId, CatalogStatus, LocalizedText, SeoMetadata } from '@iecp/types';

import type { Brand } from '../entities/brand.entity';

export const BRAND_REPOSITORY = Symbol('BRAND_REPOSITORY');

export interface ListBrandsFilter {
  status?: CatalogStatus;
  search?: string;
  cursor?: string;
  limit: number;
}

export interface BrandRepositoryPort {
  findById(id: BrandId): Promise<Brand | null>;
  findBySlug(slug: string): Promise<Brand | null>;
  existsBySlug(slug: string): Promise<boolean>;
  list(filter: ListBrandsFilter): Promise<{ items: Brand[]; nextCursor: string | null }>;
  create(props: {
    name: string;
    slug: string;
    localizedName?: LocalizedText | null;
    description?: string | null;
    logoMediaId?: string | null;
    sortOrder?: number;
    seo?: SeoMetadata | null;
  }): Promise<Brand>;
  update(
    id: BrandId,
    props: Partial<{
      name: string;
      slug: string;
      localizedName: LocalizedText | null;
      description: string | null;
      logoMediaId: string | null;
      status: CatalogStatus;
      sortOrder: number;
      seo: SeoMetadata | null;
    }>,
  ): Promise<Brand>;
  softDelete(id: BrandId): Promise<void>;
  hasProducts(id: BrandId): Promise<boolean>;
}
