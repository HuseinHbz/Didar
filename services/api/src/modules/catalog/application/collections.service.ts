import type {
  CatalogStatus,
  CollectionId,
  CollectionRules,
  CollectionType,
  LocalizedText,
  SeoMetadata,
} from '@iecp/types';
import { slugSchema } from '@iecp/validation';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Collection } from '../domain/entities/collection.entity';
import {
  COLLECTION_REPOSITORY,
  type CollectionRepositoryPort,
  type ListCollectionsFilter,
} from '../domain/ports/collection.repository.port';
import { SlugGenerator } from '../domain/services/slug-generator';

@Injectable()
export class CollectionsService {
  constructor(
    @Inject(COLLECTION_REPOSITORY) private readonly collections: CollectionRepositoryPort,
  ) {}

  async get(id: CollectionId): Promise<Collection> {
    const collection = await this.collections.findById(id);
    if (!collection) throw new NotFoundException('Collection not found');
    return collection;
  }

  async getBySlug(slug: string): Promise<Collection> {
    const collection = await this.collections.findBySlug(slug);
    if (!collection) throw new NotFoundException('Collection not found');
    return collection;
  }

  list(filter: ListCollectionsFilter): Promise<{ items: Collection[]; nextCursor: string | null }> {
    return this.collections.list(filter);
  }

  async create(input: {
    name: string;
    slug?: string;
    localizedName?: LocalizedText | null;
    description?: string | null;
    type?: CollectionType;
    rules?: CollectionRules | null;
    priority?: number;
    startAt?: Date | null;
    endAt?: Date | null;
    imageMediaId?: string | null;
    seo?: SeoMetadata | null;
  }): Promise<Collection> {
    if (input.type === 'DYNAMIC' && !input.rules) {
      throw new BadRequestException('A DYNAMIC collection requires a rules bag');
    }
    const slug = await this.resolveSlug(input.slug ?? input.name);
    return this.collections.create({ ...input, slug });
  }

  async update(
    id: CollectionId,
    input: Partial<{
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
  ): Promise<Collection> {
    const current = await this.get(id);
    const nextType = input.type ?? current.type;
    const nextRules = input.rules !== undefined ? input.rules : current.rules;
    if (nextType === 'DYNAMIC' && !nextRules) {
      throw new BadRequestException('A DYNAMIC collection requires a rules bag');
    }

    if (input.slug !== undefined) {
      slugSchema.parse(input.slug);
      const existing = await this.collections.findBySlug(input.slug);
      if (existing && existing.id !== id) {
        throw new ConflictException(`Slug "${input.slug}" is already in use`);
      }
    }

    return this.collections.update(id, input);
  }

  async delete(id: CollectionId): Promise<void> {
    await this.get(id);
    await this.collections.softDelete(id);
  }

  async listMembers(
    id: CollectionId,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: string[]; nextCursor: string | null }> {
    const collection = await this.get(id);
    if (collection.type === 'MANUAL') {
      // Manual collections are admin-curated and expected to stay small —
      // returned whole rather than cursor-paginated (unlike DYNAMIC, which
      // can span the entire catalog).
      const items = await this.collections.listProductIds(id);
      return { items, nextCursor: null };
    }
    if (!collection.rules) {
      return { items: [], nextCursor: null };
    }
    return this.collections.listDynamicMemberProductIds(collection.rules, pagination);
  }

  async addProduct(id: CollectionId, productId: string, sortOrder?: number): Promise<void> {
    const collection = await this.get(id);
    this.assertManual(collection);
    await this.collections.addProduct(id, productId, sortOrder);
  }

  async removeProduct(id: CollectionId, productId: string): Promise<void> {
    const collection = await this.get(id);
    this.assertManual(collection);
    await this.collections.removeProduct(id, productId);
  }

  async reorderProducts(id: CollectionId, orderedProductIds: string[]): Promise<void> {
    const collection = await this.get(id);
    this.assertManual(collection);
    await this.collections.reorderProducts(id, orderedProductIds);
  }

  private assertManual(collection: Collection): void {
    if (collection.type !== 'MANUAL') {
      throw new BadRequestException(
        'Only MANUAL collections support explicit product membership edits',
      );
    }
  }

  private async resolveSlug(seed: string): Promise<string> {
    const base = slugSchema.safeParse(seed).success ? seed : SlugGenerator.base(seed);
    for (let attempt = 1; attempt <= 20; attempt++) {
      const candidate = SlugGenerator.withSuffix(base, attempt);
      if (!(await this.collections.existsBySlug(candidate))) {
        return candidate;
      }
    }
    throw new ConflictException('Could not derive a unique slug — please provide one explicitly');
  }
}
