import type { BrandId, CatalogStatus, LocalizedText, SeoMetadata } from '@iecp/types';
import { slugSchema } from '@iecp/validation';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { Brand } from '../domain/entities/brand.entity';
import {
  BRAND_REPOSITORY,
  type BrandRepositoryPort,
  type ListBrandsFilter,
} from '../domain/ports/brand.repository.port';
import { SlugGenerator } from '../domain/services/slug-generator';

/**
 * Application service for Brand admin CRUD (Phase 005). One service per
 * catalog entity rather than one class per action — a deliberate,
 * coarser granularity than identity's use-case-per-file convention, kept
 * so this module's file count stays tractable; see
 * services/api/src/modules/catalog/README.md's "Application layer
 * granularity" section for the reasoning. Every method still goes through
 * the same domain/port boundary identity's use cases do.
 */
@Injectable()
export class BrandsService {
  constructor(@Inject(BRAND_REPOSITORY) private readonly brands: BrandRepositoryPort) {}

  async get(id: BrandId): Promise<Brand> {
    const brand = await this.brands.findById(id);
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  async getBySlug(slug: string): Promise<Brand> {
    const brand = await this.brands.findBySlug(slug);
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  list(filter: ListBrandsFilter): Promise<{ items: Brand[]; nextCursor: string | null }> {
    return this.brands.list(filter);
  }

  async create(input: {
    name: string;
    slug?: string;
    localizedName?: LocalizedText | null;
    description?: string | null;
    logoMediaId?: string | null;
    sortOrder?: number;
    seo?: SeoMetadata | null;
  }): Promise<Brand> {
    const slug = await this.resolveSlug(input.slug ?? input.name);
    return this.brands.create({ ...input, slug });
  }

  async update(
    id: BrandId,
    input: Partial<{
      name: string;
      slug: string;
      localizedName: LocalizedText | null;
      description: string | null;
      logoMediaId: string | null;
      status: CatalogStatus;
      sortOrder: number;
      seo: SeoMetadata | null;
    }>,
  ): Promise<Brand> {
    await this.get(id);
    if (input.slug !== undefined) {
      slugSchema.parse(input.slug);
      const existing = await this.brands.findBySlug(input.slug);
      if (existing && existing.id !== id) {
        throw new ConflictException(`Slug "${input.slug}" is already in use`);
      }
    }
    return this.brands.update(id, input);
  }

  async delete(id: BrandId): Promise<void> {
    await this.get(id);
    if (await this.brands.hasProducts(id)) {
      throw new ConflictException(
        'Cannot delete a brand that still has products — reassign or archive them first',
      );
    }
    await this.brands.softDelete(id);
  }

  /** Derives a slug from `seed` (a name or an explicit override) and
   * probes for uniqueness, same collision-breaking scheme every
   * `*Service.create` in this module uses (see SlugGenerator). */
  private async resolveSlug(seed: string): Promise<string> {
    const base = slugSchema.safeParse(seed).success ? seed : SlugGenerator.base(seed);
    for (let attempt = 1; attempt <= 20; attempt++) {
      const candidate = SlugGenerator.withSuffix(base, attempt);
      if (!(await this.brands.existsBySlug(candidate))) {
        return candidate;
      }
    }
    throw new ConflictException('Could not derive a unique slug — please provide one explicitly');
  }
}
