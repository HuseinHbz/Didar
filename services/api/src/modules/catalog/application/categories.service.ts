import type { CatalogStatus, CategoryId, LocalizedText, SeoMetadata } from '@iecp/types';
import { slugSchema } from '@iecp/validation';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Category } from '../domain/entities/category.entity';
import {
  CATEGORY_REPOSITORY,
  type CategoryRepositoryPort,
  type ListCategoriesFilter,
} from '../domain/ports/category.repository.port';
import { CategoryHierarchyService } from '../domain/services/category-hierarchy';
import { SlugGenerator } from '../domain/services/slug-generator';

@Injectable()
export class CategoriesService {
  constructor(@Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepositoryPort) {}

  async get(id: CategoryId): Promise<Category> {
    const category = await this.categories.findById(id);
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async getBySlug(slug: string): Promise<Category> {
    const category = await this.categories.findBySlug(slug);
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  list(filter: ListCategoriesFilter): Promise<{ items: Category[]; nextCursor: string | null }> {
    return this.categories.list(filter);
  }

  async create(input: {
    parentId?: string | null;
    name: string;
    slug?: string;
    localizedName?: LocalizedText | null;
    description?: string | null;
    imageMediaId?: string | null;
    sortOrder?: number;
    seo?: SeoMetadata | null;
  }): Promise<Category> {
    if (input.parentId) {
      await this.get(input.parentId as CategoryId);
    }
    const slug = await this.resolveSlug(input.slug ?? input.name);
    return this.categories.create({ ...input, slug });
  }

  async update(
    id: CategoryId,
    input: Partial<{
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
  ): Promise<Category> {
    await this.get(id);

    if (input.parentId !== undefined && input.parentId !== null) {
      const nodes = await this.categories.listAllNodes();
      if (CategoryHierarchyService.wouldCreateCycle(nodes, id, input.parentId)) {
        throw new BadRequestException('That parent would create a cycle in the category tree');
      }
    }

    if (input.slug !== undefined) {
      slugSchema.parse(input.slug);
      const existing = await this.categories.findBySlug(input.slug);
      if (existing && existing.id !== id) {
        throw new ConflictException(`Slug "${input.slug}" is already in use`);
      }
    }

    return this.categories.update(id, input);
  }

  async delete(id: CategoryId): Promise<void> {
    await this.get(id);
    if (await this.categories.hasChildren(id)) {
      throw new ConflictException('Cannot delete a category that still has subcategories');
    }
    if (await this.categories.hasProducts(id)) {
      throw new ConflictException(
        'Cannot delete a category that still has products — reassign them first',
      );
    }
    await this.categories.softDelete(id);
  }

  private async resolveSlug(seed: string): Promise<string> {
    const base = slugSchema.safeParse(seed).success ? seed : SlugGenerator.base(seed);
    for (let attempt = 1; attempt <= 20; attempt++) {
      const candidate = SlugGenerator.withSuffix(base, attempt);
      if (!(await this.categories.existsBySlug(candidate))) {
        return candidate;
      }
    }
    throw new ConflictException('Could not derive a unique slug — please provide one explicitly');
  }
}
